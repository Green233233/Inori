/**
 * 共享空间：两端都能写、都能看的小便签/里程碑。
 *
 * 存在服务器 sync_records（kind=shared.note），正文用配对密钥加密；服务器只有
 * 密文。游标独立于日记同步，失败不影响其他同步。
 */
import {api} from '../net/ApiClient';
import {openJson, sealJson} from '../crypto/Crypto';
import {native, joinPath, paths} from '../native/InorinalNative';
import type {PairSummary} from '../data/pairTypes';

export interface SharedNote {
  id: string;
  text: string;
  authorDeviceId: string;
  at: number;
  kind: 'note' | 'milestone';
}

interface SharedRecord {
  recordId: string;
  kind: string;
  ciphertext: string;
  updatedAt: number;
  deleted: boolean;
  authorDevice: string;
}

interface SharedPage {
  items: SharedRecord[];
  cursor: number;
  hasMore: boolean;
}

interface SharedState {
  cursor: number;
  notes: Record<string, SharedNote>;
}

const EMPTY: SharedState = {cursor: 0, notes: {}};
let cache: SharedState | null = null;

function statePath(): string {
  return joinPath(paths.files, 'qi', 'shared.json');
}

function normalize(raw: any): SharedState {
  if (!raw || typeof raw !== 'object') {
    return {cursor: 0, notes: {}};
  }
  const notes: Record<string, SharedNote> = {};
  for (const [key, value] of Object.entries<any>(raw.notes ?? {})) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    notes[key] = {
      id: String(value.id ?? key),
      text: String(value.text ?? ''),
      authorDeviceId: String(value.authorDeviceId ?? ''),
      at: Number(value.at) || 0,
      kind: value.kind === 'milestone' ? 'milestone' : 'note',
    };
  }
  return {cursor: Number(raw.cursor) || 0, notes};
}

async function loadState(): Promise<SharedState> {
  if (cache) {
    return cache;
  }
  try {
    cache = normalize(JSON.parse(await native.readText(statePath())));
  } catch {
    cache = {...EMPTY, notes: {}};
  }
  return cache;
}

async function saveState(next: SharedState): Promise<void> {
  cache = next;
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(statePath(), JSON.stringify(next));
}

export async function loadSharedSpace(): Promise<SharedNote[]> {
  const state = await loadState();
  return Object.values(state.notes).sort((a, b) => b.at - a.at);
}

export async function postSharedNote(
  pair: PairSummary,
  myDeviceId: string,
  text: string,
  kind: 'note' | 'milestone' = 'note',
): Promise<SharedNote> {
  const trimmed = text.trim().slice(0, 300);
  if (!trimmed) {
    throw new Error('先写点什么吧');
  }
  if (!pair.peerPubkey) {
    throw new Error('对方公钥缺失');
  }
  const at = Date.now();
  const id = `sn_${at.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const note: SharedNote = {
    id,
    text: trimmed,
    authorDeviceId: myDeviceId,
    at,
    kind,
  };
  const envelope = await sealJson(pair.pairId, pair.peerPubkey, note);
  await api(`/api/v1/sync/records/${id}`, {
    method: 'PUT',
    body: {
      kind: 'shared.note',
      ciphertext: JSON.stringify(envelope),
      revision: 1,
      updatedAt: at,
      deleted: false,
    },
  });
  const state = await loadState();
  state.notes[id] = note;
  await saveState(state);
  return note;
}

export async function deleteSharedNote(
  pair: PairSummary,
  noteId: string,
): Promise<void> {
  const state = await loadState();
  const note = state.notes[noteId];
  if (!note) {
    return;
  }
  await api(`/api/v1/sync/records/${noteId}`, {
    method: 'PUT',
    body: {
      kind: 'shared.note',
      ciphertext: 'deleted',
      revision: 1,
      updatedAt: Date.now(),
      deleted: true,
    },
  });
  delete state.notes[noteId];
  await saveState(state);
}

export async function refreshSharedSpace(
  pair: PairSummary,
): Promise<SharedNote[]> {
  if (!pair.peerPubkey) {
    return loadSharedSpace();
  }
  let state = await loadState();
  let pages = 0;
  while (pages < 5) {
    pages += 1;
    const page = await api<SharedPage>(
      `/api/v1/sync/records?sinceSeq=${state.cursor}&limit=100`,
    );
    for (const item of page.items) {
      if (item.kind !== 'shared.note') {
        continue;
      }
      if (item.deleted) {
        delete state.notes[item.recordId];
        continue;
      }
      try {
        const envelope = JSON.parse(item.ciphertext) as {n: string; c: string};
        const note = await openJson<SharedNote>(
          pair.pairId,
          pair.peerPubkey,
          envelope,
        );
        if (note?.id && note.text) {
          state.notes[note.id] = {
            id: note.id,
            text: note.text,
            authorDeviceId: note.authorDeviceId || item.authorDevice,
            at: Number(note.at) || item.updatedAt,
            kind: note.kind === 'milestone' ? 'milestone' : 'note',
          };
        }
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
  return Object.values(state.notes).sort((a, b) => b.at - a.at);
}
