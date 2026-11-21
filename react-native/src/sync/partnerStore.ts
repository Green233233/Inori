/**
 * 共享日记同步（P1）。
 *
 * - `visibility === 'pair'` 用配对密钥加密，双方都能解；`private` 用本机
 *   公钥自封后上传做云备份，对方和服务端都解不开。
 * - 正文作为 sync 记录存到服务器；服务器只有密文。
 * - 对方共享条目以只读镜像落到 `files/qi/partner.json`，LWW（updatedAt）合并。
 */
import {api, ApiError} from '../net/ApiClient';
import {openJson, sealJson, selfSealJson} from '../crypto/Crypto';
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
  audience?: 'pair' | 'self';
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

/** 私密日记的云备份记录，独立前缀，避免和共享记录互相覆盖。 */
export function selfRecordId(entryId: string): string {
  const safe = entryId.replace(/[^A-Za-z0-9_-]/g, '');
  const padded = safe.length >= 6 ? safe : `${safe}${Date.now().toString(36)}`;
  return `js${padded}`.slice(0, 64);
}

type CloudAudience = 'pair' | 'self';

function cloudStatePath(): string {
  return joinPath(paths.files, 'qi', 'journal-cloud.json');
}

async function loadCloudState(): Promise<Record<string, CloudAudience>> {
  try {
    const raw = JSON.parse(await native.readText(cloudStatePath()));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

async function saveCloudState(state: Record<string, CloudAudience>): Promise<void> {
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(cloudStatePath(), JSON.stringify(state));
}

/** 切可见范围时给旧 audience 发墓碑，免得对方镜像里留一条过期副本。 */
async function tombstone(
  pair: PairSummary,
  myDeviceId: string,
  entryId: string,
  audience: CloudAudience,
  updatedAt: number,
): Promise<void> {
  const envelope =
    audience === 'self'
      ? await selfSealJson(myDeviceId, {deleted: true})
      : await sealJson(pair.pairId, pair.peerPubkey || '', {deleted: true});
  await api(
    `/api/v1/sync/records/${
      audience === 'self' ? selfRecordId(entryId) : partnerRecordId(entryId)
    }`,
    {
      method: 'PUT',
      body: {
        kind: 'journal',
        ciphertext: JSON.stringify(envelope),
        revision: 1,
        updatedAt,
        deleted: true,
        audience,
      },
    },
  ).catch(() => undefined);
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
  /** 第一条失败原因，便于在界面上说清「为什么没同步过去」。 */
  lastError?: string;
  /** 这一轮是不是因为「根本连不上」而提前收手，没再逐条去试。 */
  aborted?: boolean;
}

/** 单轮最多推多少条：网络坏掉时不要把几十条挨个试一遍，把 JS 线程让出来。 */
const MAX_PUSH_PER_RUN = 20;

/** 单条记录的上传超时；比默认 15s 短，失败得快一点。 */
const RECORD_TIMEOUT_MS = 8_000;

/**
 * 连接层面的失败（断网、服务端 5xx、超时、限流）。
 *
 * 这类失败下一条也一定失败，继续循环只会把整个同步拖成几分钟、
 * 期间界面上的其他操作全部排队等它——所以直接收手，交给上层的退避重试。
 */
function isConnectivityFailure(error: unknown): boolean {
  if (error instanceof ApiError) {
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  // 原生 HTTP 抛出的传输层错误不是 ApiError，同样视为「现在连不上」。
  return true;
}

/** 推送本人条目：共享的给双方，私密的自封后只给自己做云备份。 */
export async function pushOwnEntries(
  pair: PairSummary,
  myDeviceId: string,
): Promise<{pushed: number; failed: number; lastError?: string; aborted?: boolean}> {
  if (!pair.peerPubkey) {
    return {pushed: 0, failed: 0};
  }
  const summaries = await loadIndex();
  const cloud = await loadCloudState();
  let pushed = 0;
  let failed = 0;
  let lastError: string | undefined;
  let aborted = false;
  for (const summary of summaries) {
    // 一轮只推有限条：条目再多也要及时把 JS 线程交还给界面。
    if (pushed + failed >= MAX_PUSH_PER_RUN) {
      aborted = true;
      break;
    }
    const isPrivate = summary.visibility === 'private';
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
      let envelope: {n: string; c: string};
      let recordId: string;
      const audience: CloudAudience = isPrivate ? 'self' : 'pair';
      if (isPrivate) {
        // 私密日记不外发正文，但保留一份只有本机能解开的云备份。
        envelope = await selfSealJson(myDeviceId, {
          entry: {
            ...entry,
            visibility: 'private',
            authorDeviceId: myDeviceId,
            revision: entry.revision ?? 1,
          },
        });
        recordId = selfRecordId(entry.id);
      } else {
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
        envelope = await sealJson(pair.pairId, pair.peerPubkey, {
          entry: payloadEntry,
        });
        recordId = partnerRecordId(entry.id);
      }
      await api(`/api/v1/sync/records/${recordId}`, {
        method: 'PUT',
        timeoutMs: RECORD_TIMEOUT_MS,
        body: {
          kind: 'journal',
          ciphertext: JSON.stringify(envelope),
          revision: entry.revision ?? 1,
          updatedAt: entry.updatedAt,
          deleted: false,
          audience,
        },
      });
      const previous = cloud[entry.id];
      if (previous && previous !== audience) {
        await tombstone(pair, myDeviceId, entry.id, previous, entry.updatedAt);
      }
      cloud[entry.id] = audience;
      pushed += 1;
    } catch (error: any) {
      failed += 1;
      lastError = error?.message ? String(error.message) : '同步失败';
      /*
       * 连不上就别再一条条试了：每条都要等超时，几十条叠起来就是好几分钟，
       * 期间别的功能全在排队。把剩下的交给下一次（带退避的）同步。
       */
      if (isConnectivityFailure(error)) {
        aborted = true;
        break;
      }
    }
  }
  await saveCloudState(cloud).catch(() => undefined);
  return {pushed, failed, lastError, aborted};
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
      if (item.kind !== 'journal' || item.audience === 'self') {
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
  const push = await pushOwnEntries(pair, myDeviceId).catch((error: any) => ({
    pushed: 0,
    failed: 1,
    lastError: error?.message ? String(error.message) : '同步失败',
    aborted: true,
  }));
  /*
   * 推送阶段就已经确认连不上，就别再发拉取请求了：那又是一次完整的超时等待，
   * 只会让这一轮同步拖得更久。
   */
  if (push.aborted) {
    return {
      pushed: push.pushed,
      pulled: 0,
      failed: push.failed,
      lastError: push.lastError,
      aborted: true,
    };
  }
  const pull = await pullPartnerEntries(pair, myDeviceId).catch(() => ({
    pulled: 0,
    failed: 1,
  }));
  return {
    pushed: push.pushed,
    pulled: pull.pulled,
    failed: push.failed + pull.failed,
    lastError: push.lastError,
    aborted: push.aborted,
  };
}
