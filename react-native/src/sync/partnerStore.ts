/**
 * 共享日记同步（P1）。
 *
 * - 只同步 `visibility === 'pair'` 的条目；`private` 条目永不出本机。
 * - 正文以配对密钥加密后作为 relay 记录存到服务器；服务器只有密文。
 * - 对方条目以只读镜像落到 `files/qi/partner.json`，LWW（updatedAt）合并。
 */
import {api} from '../net/ApiClient';
import {openJson, sealJson} from '../crypto/Crypto';
import {native, joinPath, paths} from '../native/InorinalNative';
import {getEntry, loadIndex} from '../data/storage';
import type {EntrySummary, JournalEntry} from '../data/types';
import type {PairSummary} from '../data/pairTypes';
import {htmlToPlainText, previewOf} from '../data/html';

interface PartnerRecord {
  authorDeviceId: string;
  updatedAt: number;
  deleted: boolean;
  entry?: JournalEntry;
  /** 服务器记录 id，仅用于把删除标记映射回本地条目。 */
  recordId?: string;
}

interface PartnerState {
  cursor: number;
  entries: Record<string, PartnerRecord>;
}

interface SyncRecord {
  recordId: string;
  kind: string;
  ciphertext: string;
  revision: number;
  updatedAt: number;
  deleted: boolean;
  authorDevice: string;
  seq: number;
}

interface SyncPage {
  items: SyncRecord[];
  cursor: number;
  hasMore: boolean;
}

const EMPTY: PartnerState = {cursor: 0, entries: {}};
let cache: PartnerState | null = null;

function statePath(): string {
  return joinPath(paths.files, 'qi', 'partner.json');
}

function normalize(raw: any): PartnerState {
  if (!raw || typeof raw !== 'object') {
    return {cursor: 0, entries: {}};
  }
  const entries: Record<string, PartnerRecord> = {};
  if (raw.entries && typeof raw.entries === 'object') {
    for (const [key, value] of Object.entries<any>(raw.entries)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      entries[key] = {
        authorDeviceId: String(value.authorDeviceId ?? ''),
        updatedAt: Number(value.updatedAt) || 0,
        deleted: value.deleted === true,
        entry: value.entry && typeof value.entry === 'object' ? value.entry : undefined,
      };
    }
  }
  return {cursor: Number(raw.cursor) || 0, entries};
}

export async function loadPartnerState(): Promise<PartnerState> {
  if (cache) {
    return cache;
  }
  try {
    const text = await native.readText(statePath());
    cache = normalize(JSON.parse(text));
  } catch {
    cache = {...EMPTY, entries: {}};
  }
  return cache;
}

async function savePartnerState(next: PartnerState): Promise<void> {
  cache = next;
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(statePath(), JSON.stringify(next));
}

export async function resetPartnerState(): Promise<void> {
  cache = {...EMPTY, entries: {}};
  await native.deletePath(statePath()).catch(() => false);
}

/** Record ids must match `[A-Za-z0-9_-]{8,64}` on the server. */
export function partnerRecordId(entryId: string): string {
  const safe = entryId.replace(/[^A-Za-z0-9_-]/g, '');
  const padded = safe.length >= 6 ? safe : `${safe}${Date.now().toString(36)}`;
  return `jr${padded}`.slice(0, 64);
}

function toSummary(entry: JournalEntry, authorDeviceId: string): EntrySummary {
  return {
    id: entry.id,
    title: entry.title,
    date: entry.date,
    weather: entry.weather,
    mood: entry.mood,
    category: entry.category,
    isFavorite: false,
    imageUrl: entry.imageUrl ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    preview: previewOf(entry.content ?? ''),
    searchText: htmlToPlainText(entry.content ?? '').slice(0, 200000),
    visibility: 'pair',
    authorDeviceId,
    readOnly: true,
  };
}

export async function partnerSummaries(): Promise<EntrySummary[]> {
  const state = await loadPartnerState();
  return Object.values(state.entries)
    .filter(record => !record.deleted && record.entry)
    .map(record => toSummary(record.entry as JournalEntry, record.authorDeviceId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPartnerEntry(entryId: string): Promise<JournalEntry | null> {
  const state = await loadPartnerState();
  const record = state.entries[entryId];
  if (!record || record.deleted || !record.entry) {
    return null;
  }
  return record.entry;
}

export async function isPartnerEntry(entryId: string): Promise<boolean> {
  const state = await loadPartnerState();
  return !!state.entries[entryId];
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  failed: number;
}

/** 推送本人可共享条目；私密条目跳过。 */
export async function pushOwnEntries(
  pair: PairSummary,
  myDeviceId: string,
): Promise<{pushed: number; failed: number}> {
  if (!pair.peerPubkey) {
    return {pushed: 0, failed: 0};
  }
  const summaries = await loadIndex();
  let pushed = 0;
  let failed = 0;
  for (const summary of summaries) {
    if (summary.visibility === 'private') {
      continue;
    }
    const entry = await getEntry(summary.id);
    if (!entry) {
      continue;
    }
    /*
     * 只推自己写的条目。对方共享过来的镜像会被合并进本地日记列表，
     * 若再推回去就会在对方那里出现一条假的「TA 的日记」副本（自己看自己）。
     */
    if (entry.authorDeviceId && entry.authorDeviceId !== myDeviceId) {
      continue;
    }
    try {
      /*
       * The other side cannot read our private media paths, so the shared copy
       * inlines every picture/sticker/doodle as a data URI. That keeps the
       * partner view identical to ours (rich text, images, stickers) without
       * adding a second media-sync protocol.
       */
      const sharedContent = await native
        .toDisplayableHtml(entry.id, entry.content ?? '')
        .catch(() => entry.content ?? '');
      const payloadEntry: JournalEntry = {
        ...entry,
        content: sharedContent,
        visibility: 'pair',
        authorDeviceId: myDeviceId,
        revision: entry.revision ?? 1,
      };
      const envelope = await sealJson(pair.pairId, pair.peerPubkey, {
        entry: payloadEntry,
      });
      await api(`/api/v1/sync/records/${partnerRecordId(entry.id)}`, {
        method: 'PUT',
        body: {
          kind: 'journal',
          ciphertext: JSON.stringify(envelope),
          revision: entry.revision ?? 1,
          updatedAt: entry.updatedAt,
          deleted: false,
        },
      });
      pushed += 1;
    } catch {
      failed += 1;
    }
  }
  return {pushed, failed};
}

/** 拉取对方条目并按 LWW 合并进本地镜像。 */
export async function pullPartnerEntries(
  pair: PairSummary,
  myDeviceId?: string,
): Promise<{pulled: number; failed: number}> {
  if (!pair.peerPubkey) {
    return {pulled: 0, failed: 0};
  }
  let state = await loadPartnerState();
  let pulled = 0;
  let failed = 0;
  let pages = 0;
  while (pages < 5) {
    pages += 1;
    const page = await api<SyncPage>(
      `/api/v1/sync/records?sinceSeq=${state.cursor}&limit=100`,
    );
    for (const item of page.items) {
      if (item.kind !== 'journal') {
        continue;
      }
      // 自己推送的共享副本不该在本地再显示成「TA 的日记」，否则同一篇会出现两遍。
      if (myDeviceId && item.authorDevice === myDeviceId) {
        continue;
      }
      try {
        const existing = state.entries[item.recordId];
        if (existing && existing.updatedAt > item.updatedAt) {
          continue;
        }
        if (item.deleted) {
          const target = Object.entries(state.entries).find(
            ([, record]) => record.recordId === item.recordId,
          );
          if (target) {
            state.entries[target[0]] = {
              ...target[1],
              updatedAt: item.updatedAt,
              deleted: true,
              entry: undefined,
            };
          }
          continue;
        }
        const envelope = JSON.parse(item.ciphertext) as {n: string; c: string};
        const payload = await openJson<{entry: JournalEntry}>(
          pair.pairId,
          pair.peerPubkey,
          envelope,
        );
        const entry = payload.entry;
        if (!entry?.id) {
          continue;
        }
        state.entries[entry.id] = {
          authorDeviceId: item.authorDevice,
          updatedAt: item.updatedAt,
          deleted: false,
          entry: {...entry, visibility: 'pair', authorDeviceId: item.authorDevice},
          recordId: item.recordId,
        };
        pulled += 1;
      } catch {
        failed += 1;
      }
    }
    state = {...state, cursor: page.cursor};
    if (!page.hasMore) {
      break;
    }
  }
  await savePartnerState(state);
  return {pulled, failed};
}

export async function syncJournal(
  pair: PairSummary,
  myDeviceId: string,
): Promise<SyncResult> {
  const push = await pushOwnEntries(pair, myDeviceId).catch(() => ({
    pushed: 0,
    failed: 1,
  }));
  const pull = await pullPartnerEntries(pair, myDeviceId).catch(() => ({
    pulled: 0,
    failed: 1,
  }));
  return {pushed: push.pushed, pulled: pull.pulled, failed: push.failed + pull.failed};
}
