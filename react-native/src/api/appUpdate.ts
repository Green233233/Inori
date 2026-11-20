/**
 * 「检查更新」客户端契约：GET /api/v1/app/update + 本地版本比较。
 *
 * 服务端没有版本号字段也不怕：先比 versionCode，缺失时退回按 version 的
 * 数字段逐段比较（v0.6.7 vs 0.6.8）。网络失败一律静默返回 null，启动时的
 * 自动检查不应该打断写日记。
 */
import {api} from '../net/ApiClient';
import {VERSION_CODE, VERSION_NAME} from '../config';

export interface AppUpdateInfo {
  version: string;
  versionCode: number;
  notes: string;
  downloadUrl: string;
  force: boolean;
}

export interface UpdateCheckResult extends AppUpdateInfo {
  hasUpdate: boolean;
}

interface AppUpdatePayload {
  ok?: boolean;
  version?: unknown;
  versionCode?: unknown;
  notes?: unknown;
  downloadUrl?: unknown;
  force?: unknown;
}

/** 把 `v0.6.8` / `0.6.8` 拆成数字段，忽略非数字尾巴（如 `-beta`）。 */
export function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map(part => Number.parseInt(part, 10))
    .filter(part => Number.isFinite(part));
}

/** 远端版本是否比本地新；段数不同时缺的段按 0 处理。 */
export function isNewerVersion(remote: string, local: string): boolean {
  const left = parseVersionParts(remote);
  const right = parseVersionParts(local);
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return false;
}

/** 读取服务端版本；任何失败都返回 null，不抛错。 */
export async function fetchUpdateInfo(): Promise<AppUpdateInfo | null> {
  try {
    const payload = await api<AppUpdatePayload>('/api/v1/app/update', {
      auth: false,
      timeoutMs: 8000,
    });
    const version = typeof payload.version === 'string' ? payload.version : '';
    if (!version) {
      return null;
    }
    const rawCode = Number(payload.versionCode);
    return {
      version,
      versionCode: Number.isFinite(rawCode) && rawCode > 0 ? rawCode : 0,
      notes: typeof payload.notes === 'string' ? payload.notes : '',
      downloadUrl:
        typeof payload.downloadUrl === 'string' ? payload.downloadUrl : '',
      force: payload.force === true,
    };
  } catch {
    return null;
  }
}

/** 检查是否有新版本；返回 null 表示「查不到」，调用方据此区分网络问题。 */
export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  const info = await fetchUpdateInfo();
  if (!info) {
    return null;
  }
  const hasUpdate =
    info.versionCode > VERSION_CODE
      ? true
      : info.versionCode > 0 && info.versionCode < VERSION_CODE
        ? false
        : isNewerVersion(info.version, VERSION_NAME);
  return {...info, hasUpdate};
}
