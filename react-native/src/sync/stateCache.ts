/**
 * 对方状态的本机缓存。
 *
 * 服务器只暂存密文，页面打开时先读这里；缓存过期才走直连兜底。
 * 每类状态一个文件，内容已解密，留在本机 files/qi/state/<kind>.json。
 */
import {joinPath, native, paths} from '../native/InorinalNative';

export type StateKind =
  | 'status'
  | 'usage'
  | 'location'
  | 'permissions'
  | 'applimit'
  | 'trail'
  | 'rules'
  | 'notifications'
  | 'profile';

export type StateSource = 'staging' | 'direct';

export interface StateEnvelope<T = any> {
  data: T;
  at: number;
  source: StateSource;
}

const KINDS = new Set<StateKind>([
  'status',
  'usage',
  'location',
  'permissions',
  'applimit',
  'trail',
  'rules',
  'notifications',
  'profile',
]);

function dir(): string {
  return joinPath(paths.files, 'qi', 'state');
}

function fileOf(kind: StateKind): string {
  return joinPath(dir(), `${kind}.json`);
}

export async function readState<T = any>(
  kind: StateKind,
): Promise<StateEnvelope<T> | null> {
  if (!KINDS.has(kind)) {
    return null;
  }
  try {
    const text = await native.readText(fileOf(kind));
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || raw.data === undefined) {
      return null;
    }
    return {
      data: raw.data as T,
      at: Number(raw.at) || 0,
      source: raw.source === 'direct' ? 'direct' : 'staging',
    };
  } catch {
    return null;
  }
}

export async function writeState<T = any>(
  kind: StateKind,
  data: T,
  source: StateSource,
  at = Date.now(),
): Promise<void> {
  if (!KINDS.has(kind)) {
    return;
  }
  await native.makeDir(dir()).catch(() => false);
  await native.writeText(
    fileOf(kind),
    JSON.stringify({data, at, source} satisfies StateEnvelope<T>),
  );
}

export async function clearState(kind?: StateKind): Promise<void> {
  if (kind) {
    await native.deletePath(fileOf(kind)).catch(() => false);
    return;
  }
  for (const item of KINDS) {
    await native.deletePath(fileOf(item)).catch(() => false);
  }
}

/** 缓存新鲜就返回；过期/没有则返回 null，让调用方决定是否直连。 */
export async function freshState<T = any>(
  kind: StateKind,
  maxAgeMs: number,
): Promise<StateEnvelope<T> | null> {
  const cached = await readState<T>(kind);
  if (!cached) {
    return null;
  }
  return Date.now() - cached.at <= maxAgeMs ? cached : null;
}
