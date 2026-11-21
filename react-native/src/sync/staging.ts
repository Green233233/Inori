/**
 * 状态暂存通道（store-and-forward）。
 *
 * 发送端把状态密文 PUT 到服务器，接收端按游标拉取并 ack；服务器只有密文，
 * 72 小时 / 每对 150MB 后按最早未确认丢弃。
 */
import {api} from '../net/ApiClient';
import {openJson, sealJson} from '../crypto/Crypto';
import {joinPath, native, paths} from '../native/InorinalNative';
import type {PairSummary} from '../data/pairTypes';
import type {StateKind} from './stateCache';

export interface StagedItem {
  rev: number;
  id: number;
  fromDevice: string;
  kind: StateKind;
  ciphertext: string;
  createdAt: string;
  createdAtDisplay: string;
}

export interface StagingPage {
  ok: boolean;
  items: StagedItem[];
  cursor: number;
  usedBytes?: number;
  itemCount?: number;
  budgetBytes?: number;
  ratio?: number;
  pressure?: boolean;
}

export interface StagingSendResult {
  ok: boolean;
  rev: number;
  usedBytes: number;
  itemCount: number;
  budgetBytes: number;
  ratio: number;
  pressure: boolean;
}

export interface CloudQuota {
  ok: boolean;
  quotaBytes: number;
  cloudUsedBytes: number;
}

interface CursorState {
  cursor: number;
}

function cursorPath(): string {
  return joinPath(paths.files, 'qi', 'staging-cursor.json');
}

export async function loadStagingCursor(): Promise<number> {
  try {
    const raw = JSON.parse(await native.readText(cursorPath())) as CursorState;
    return Number(raw?.cursor) || 0;
  } catch {
    return 0;
  }
}

export async function saveStagingCursor(cursor: number): Promise<void> {
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(
    cursorPath(),
    JSON.stringify({cursor: Math.max(0, Math.floor(cursor))}),
  );
}

/** 上传一份状态快照；dedupeKey 相同会覆盖服务器上的旧快照。 */
export async function sendState(
  pair: PairSummary,
  kind: StateKind,
  value: unknown,
  dedupeKey: string = kind,
): Promise<StagingSendResult> {
  if (!pair.peerPubkey) {
    throw new Error('配对还没有完成');
  }
  const envelope = await sealJson(pair.pairId, pair.peerPubkey, value);
  return api<StagingSendResult>('/api/v1/staging/send', {
    method: 'POST',
    body: {
      kind,
      ciphertext: JSON.stringify(envelope),
      dedupeKey,
    },
    timeoutMs: 20000,
  });
}

export interface PolledState {
  id: number;
  rev: number;
  kind: StateKind;
  data: unknown;
  at: number;
  fromDevice: string;
}

/** 长轮询一次；调用方负责写缓存与 ack。解密失败也返回 error 条目，避免堵住游标。 */
export async function pollState(
  pair: PairSummary,
  cursor: number,
  waitSeconds = 25,
): Promise<{items: PolledState[]; failed: number; cursor: number; page: StagingPage}> {
  const page = await api<StagingPage>(
    `/api/v1/staging/poll?sinceRev=${encodeURIComponent(String(cursor))}&wait=${waitSeconds}`,
    {timeoutMs: (waitSeconds + 10) * 1000},
  );
  const items: PolledState[] = [];
  let failed = 0;
  for (const item of page.items) {
    try {
      const envelope = JSON.parse(item.ciphertext) as {n: string; c: string};
      const data = await openJson<unknown>(
        pair.pairId,
        pair.peerPubkey || '',
        envelope,
      );
      items.push({
        id: item.id,
        rev: item.rev,
        kind: item.kind,
        data,
        at: Date.parse(item.createdAt) || Date.now(),
        fromDevice: item.fromDevice,
      });
    } catch {
      failed += 1;
    }
  }
  return {items, failed, cursor: page.cursor, page};
}

export async function ackState(ids: number[]): Promise<number> {
  if (!ids.length) {
    return 0;
  }
  const result = await api<{ok: boolean; deleted: number}>(
    '/api/v1/staging/ack',
    {method: 'POST', body: {ids}, timeoutMs: 15000},
  );
  return result.deleted;
}

export async function fetchCloudQuota(): Promise<CloudQuota> {
  return api<CloudQuota>('/api/v1/sync/quota', {timeoutMs: 15000});
}
