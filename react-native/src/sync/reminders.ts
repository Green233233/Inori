/**
 * 定时规则：到点提醒（主人端 / 小狗端共用）。
 *
 * 规则本身走 sync_records(kind=reminder) 端到端加密同步；本机保存后交给原生
 * AlarmManager 排一次闹钟（一个闹钟只发一条通知，无常驻服务）。
 */
import {api} from '../net/ApiClient';
import {openJson, sealJson} from '../crypto/Crypto';
import {native, joinPath, paths} from '../native/InorinalNative';
import {qiDeviceAvailable, qiReminder} from '../native/QiDevice';
import type {PairSummary} from '../data/pairTypes';

export type ReminderScope = 'both' | 'master' | 'puppy';

export interface Reminder {
  id: string;
  time: string; // HH:MM
  days: number[]; // 0=周日 … 6=周六；空数组表示每天
  message: string;
  enabled: boolean;
  updatedAt: number;
  /** 谁接收：双方 / 仅主人 / 仅小狗。 */
  scope: ReminderScope;
}

let myRole: 'MASTER' | 'PUPPY' = 'MASTER';

/** 由 QiProvider 在就绪时告知本机角色，用于按 scope 过滤是否本机弹。 */
export function configureReminders(role: 'MASTER' | 'PUPPY'): void {
  myRole = role;
}

function shouldRing(reminder: Reminder): boolean {
  if (reminder.scope === 'both') {
    return true;
  }
  return reminder.scope === 'master' ? myRole === 'MASTER' : myRole === 'PUPPY';
}

interface ReminderRecord {
  recordId: string;
  kind: string;
  ciphertext: string;
  updatedAt: number;
  deleted: boolean;
}

interface ReminderPage {
  items: ReminderRecord[];
  cursor: number;
  hasMore: boolean;
}

interface ReminderState {
  cursor: number;
  items: Record<string, Reminder>;
}

const EMPTY: ReminderState = {cursor: 0, items: {}};
let cache: ReminderState | null = null;

function statePath(): string {
  return joinPath(paths.files, 'qi', 'reminders.json');
}

function normalize(raw: any): ReminderState {
  if (!raw || typeof raw !== 'object') {
    return {cursor: 0, items: {}};
  }
  const items: Record<string, Reminder> = {};
  for (const [key, value] of Object.entries<any>(raw.items ?? {})) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    items[key] = {
      id: String(value.id ?? key),
      time: /^\d{2}:\d{2}$/.test(value.time) ? value.time : '09:00',
      days: Array.isArray(value.days)
        ? value.days.filter((day: any) => Number.isInteger(day) && day >= 0 && day <= 6)
        : [],
      message: String(value.message ?? ''),
      enabled: value.enabled !== false,
      updatedAt: Number(value.updatedAt) || 0,
      scope:
        value.scope === 'master' || value.scope === 'puppy' ? value.scope : 'both',
    };
  }
  return {cursor: Number(raw.cursor) || 0, items};
}

async function loadState(): Promise<ReminderState> {
  if (cache) {
    return cache;
  }
  try {
    cache = normalize(JSON.parse(await native.readText(statePath())));
  } catch {
    cache = {...EMPTY, items: {}};
  }
  return cache;
}

async function saveState(next: ReminderState): Promise<void> {
  cache = next;
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(statePath(), JSON.stringify(next));
}

async function armNext(reminder: Reminder): Promise<void> {
  if (!qiDeviceAvailable) {
    return;
  }
  const [hour, minute] = reminder.time.split(':').map(Number);
  if (reminder.enabled && shouldRing(reminder)) {
    await qiReminder
      .schedule(
        reminder.id,
        hour,
        minute,
        reminder.days.join(','),
        reminder.message || '到时间啦',
        true,
      )
      .catch(() => undefined);
  } else {
    await qiReminder.cancel(reminder.id).catch(() => undefined);
  }
}

export async function loadReminders(): Promise<Reminder[]> {
  const state = await loadState();
  return Object.values(state.items).sort((a, b) => a.time.localeCompare(b.time));
}

async function putReminder(pair: PairSummary | null, reminder: Reminder): Promise<void> {
  const state = await loadState();
  state.items[reminder.id] = reminder;
  await saveState(state);
  await armNext(reminder);
  if (!pair?.peerPubkey) {
    return;
  }
  const envelope = await sealJson(pair.pairId, pair.peerPubkey, reminder);
  await api(`/api/v1/sync/records/${reminder.id}`, {
    method: 'PUT',
    body: {
      kind: 'reminder',
      ciphertext: JSON.stringify(envelope),
      revision: 1,
      updatedAt: reminder.updatedAt,
      deleted: false,
    },
  });
}

export async function upsertReminder(
  pair: PairSummary | null,
  reminder: Reminder,
): Promise<Reminder> {
  const next: Reminder = {...reminder, updatedAt: Date.now()};
  await putReminder(pair, next);
  return next;
}

export async function createReminder(
  pair: PairSummary | null,
  time: string,
  days: number[],
  message: string,
  scope: ReminderScope = 'both',
): Promise<Reminder> {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('时间格式应为 HH:MM（小时：分钟）');
  }
  return upsertReminder(pair, {
    id: `rm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    time,
    days,
    message: message.trim().slice(0, 80),
    enabled: true,
    updatedAt: Date.now(),
    scope,
  });
}

export async function deleteReminder(
  pair: PairSummary | null,
  reminder: Reminder,
): Promise<void> {
  const state = await loadState();
  delete state.items[reminder.id];
  await saveState(state);
  if (qiDeviceAvailable) {
    await qiReminder.cancel(reminder.id).catch(() => undefined);
  }
  if (!pair?.peerPubkey) {
    return;
  }
  await api(`/api/v1/sync/records/${reminder.id}`, {
    method: 'PUT',
    body: {
      kind: 'reminder',
      ciphertext: 'deleted',
      revision: 1,
      updatedAt: Date.now(),
      deleted: true,
    },
  });
}

export async function refreshReminders(
  pair: PairSummary | null,
): Promise<Reminder[]> {
  if (!pair?.peerPubkey) {
    return loadReminders();
  }
  let state = await loadState();
  let pages = 0;
  while (pages < 5) {
    pages += 1;
    const page = await api<ReminderPage>(
      `/api/v1/sync/records?sinceSeq=${state.cursor}&limit=100`,
    );
    for (const item of page.items) {
      if (item.kind !== 'reminder') {
        continue;
      }
      if (item.deleted) {
        delete state.items[item.recordId];
        if (qiDeviceAvailable) {
          await qiReminder.cancel(item.recordId).catch(() => undefined);
        }
        continue;
      }
      try {
        const envelope = JSON.parse(item.ciphertext) as {n: string; c: string};
        const reminder = await openJson<Reminder>(
          pair.pairId,
          pair.peerPubkey,
          envelope,
        );
        if (!reminder?.id) {
          continue;
        }
        const existing = state.items[reminder.id];
        if (existing && existing.updatedAt > reminder.updatedAt) {
          continue;
        }
        state.items[reminder.id] = reminder;
        await armNext(reminder);
      } catch {
        // 历史密文解不开，跳过。
      }
    }
    state = {...state, cursor: page.cursor};
    if (!page.hasMore) {
      break;
    }
  }
  await saveState(state);
  return loadReminders();
}
