/**
 * 任务 / 报备：主人下任务，小狗报备，主人验收。
 *
 * 记录存在 sync_records(kind=task)，正文端到端加密。四个状态：
 *   open       主人已下达
 *   submitted  小狗已报备（附带一句话）
 *   done       主人已验收
 *   cancelled  主人撤回
 */
import {api} from '../net/ApiClient';
import {openJson, sealJson} from '../crypto/Crypto';
import {native, joinPath, paths} from '../native/InorinalNative';
import type {PairSummary} from '../data/pairTypes';

export type TaskStatus = 'open' | 'submitted' | 'done' | 'cancelled';

export interface QiTask {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  submittedText?: string;
  submittedAt?: number;
  verdictText?: string;
  verdictAt?: number;
}

interface TaskRecord {
  recordId: string;
  kind: string;
  ciphertext: string;
  updatedAt: number;
  deleted: boolean;
  authorDevice: string;
}

interface TaskPage {
  items: TaskRecord[];
  cursor: number;
  hasMore: boolean;
}

interface TaskState {
  cursor: number;
  tasks: Record<string, QiTask>;
}

const EMPTY: TaskState = {cursor: 0, tasks: {}};
let cache: TaskState | null = null;

function statePath(): string {
  return joinPath(paths.files, 'qi', 'tasks.json');
}

function normalize(raw: any): TaskState {
  if (!raw || typeof raw !== 'object') {
    return {cursor: 0, tasks: {}};
  }
  const tasks: Record<string, QiTask> = {};
  for (const [key, value] of Object.entries<any>(raw.tasks ?? {})) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    tasks[key] = {
      id: String(value.id ?? key),
      title: String(value.title ?? ''),
      detail: String(value.detail ?? ''),
      status: ['open', 'submitted', 'done', 'cancelled'].includes(value.status)
        ? value.status
        : 'open',
      createdBy: String(value.createdBy ?? ''),
      createdAt: Number(value.createdAt) || 0,
      updatedAt: Number(value.updatedAt) || 0,
      submittedText: value.submittedText ? String(value.submittedText) : undefined,
      submittedAt: value.submittedAt ? Number(value.submittedAt) : undefined,
      verdictText: value.verdictText ? String(value.verdictText) : undefined,
      verdictAt: value.verdictAt ? Number(value.verdictAt) : undefined,
    };
  }
  return {cursor: Number(raw.cursor) || 0, tasks};
}

async function loadState(): Promise<TaskState> {
  if (cache) {
    return cache;
  }
  try {
    cache = normalize(JSON.parse(await native.readText(statePath())));
  } catch {
    cache = {...EMPTY, tasks: {}};
  }
  return cache;
}

async function saveState(next: TaskState): Promise<void> {
  cache = next;
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(statePath(), JSON.stringify(next));
}

export async function loadTasks(): Promise<QiTask[]> {
  const state = await loadState();
  return Object.values(state.tasks).sort((a, b) => b.createdAt - a.createdAt);
}

async function putTask(pair: PairSummary, task: QiTask): Promise<void> {
  if (!pair.peerPubkey) {
    throw new Error('对方公钥缺失');
  }
  const envelope = await sealJson(pair.pairId, pair.peerPubkey, task);
  await api(`/api/v1/sync/records/${task.id}`, {
    method: 'PUT',
    body: {
      kind: 'task',
      ciphertext: JSON.stringify(envelope),
      revision: 1,
      updatedAt: task.updatedAt,
      deleted: false,
    },
  });
  const state = await loadState();
  state.tasks[task.id] = task;
  await saveState(state);
}

export async function createTask(
  pair: PairSummary,
  myDeviceId: string,
  title: string,
  detail: string,
): Promise<QiTask> {
  const trimmed = title.trim().slice(0, 60);
  if (!trimmed) {
    throw new Error('先写任务标题');
  }
  const at = Date.now();
  const task: QiTask = {
    id: `tk_${at.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: trimmed,
    detail: detail.trim().slice(0, 300),
    status: 'open',
    createdBy: myDeviceId,
    createdAt: at,
    updatedAt: at,
  };
  await putTask(pair, task);
  return task;
}

export async function submitTask(
  pair: PairSummary,
  task: QiTask,
  text: string,
): Promise<QiTask> {
  const next: QiTask = {
    ...task,
    status: 'submitted',
    submittedText: text.trim().slice(0, 300),
    submittedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await putTask(pair, next);
  return next;
}

export async function verdictTask(
  pair: PairSummary,
  task: QiTask,
  done: boolean,
  text: string,
): Promise<QiTask> {
  const next: QiTask = {
    ...task,
    status: done ? 'done' : 'open',
    verdictText: text.trim().slice(0, 300) || undefined,
    verdictAt: Date.now(),
    updatedAt: Date.now(),
  };
  await putTask(pair, next);
  return next;
}

export async function refreshTasks(pair: PairSummary): Promise<QiTask[]> {
  if (!pair.peerPubkey) {
    return loadTasks();
  }
  let state = await loadState();
  let pages = 0;
  while (pages < 5) {
    pages += 1;
    const page = await api<TaskPage>(
      `/api/v1/sync/records?sinceSeq=${state.cursor}&limit=100`,
    );
    for (const item of page.items) {
      if (item.kind !== 'task') {
        continue;
      }
      if (item.deleted) {
        delete state.tasks[item.recordId];
        continue;
      }
      try {
        const envelope = JSON.parse(item.ciphertext) as {n: string; c: string};
        const task = await openJson<QiTask>(
          pair.pairId,
          pair.peerPubkey,
          envelope,
        );
        if (!task?.id) {
          continue;
        }
        const existing = state.tasks[task.id];
        if (existing && existing.updatedAt > task.updatedAt) {
          continue;
        }
        state.tasks[task.id] = task;
      } catch {
        // 换过密钥的历史密文解不开，跳过。
      }
    }
    state = {...state, cursor: page.cursor};
    if (!page.hasMore) {
      break;
    }
  }
  await saveState(state);
  return Object.values(state.tasks).sort((a, b) => b.createdAt - a.createdAt);
}
