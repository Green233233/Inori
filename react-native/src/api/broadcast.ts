/**
 * 全站公告：GET /api/v1/broadcast。
 *
 * 只有一行文案，显示在主页标题下面，不弹窗、不推送。任何失败都静默返回
 * null——公告是锦上添花，不该让主页报错或空转。
 */
import {api} from '../net/ApiClient';

export interface BroadcastItem {
  id: number;
  text: string;
  at: string;
  expiresAt: string;
}

interface BroadcastPayload {
  ok?: boolean;
  broadcast?: {
    id?: unknown;
    text?: unknown;
    at?: unknown;
    expiresAt?: unknown;
  } | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 读取当前公告；没有公告、过期、或请求失败都返回 null。 */
export async function fetchBroadcast(): Promise<BroadcastItem | null> {
  try {
    const payload = await api<BroadcastPayload>('/api/v1/broadcast', {
      timeoutMs: 8000,
    });
    const raw = payload.broadcast;
    const body = text(raw?.text).trim();
    if (!raw || !body) {
      return null;
    }
    const item: BroadcastItem = {
      id: Number(raw.id) || 0,
      text: body,
      at: text(raw.at),
      expiresAt: text(raw.expiresAt),
    };
    return broadcastHasExpired(item) ? null : item;
  } catch {
    return null;
  }
}

/** 到点自己消失：服务端也过滤，客户端再兜一层。 */
export function broadcastHasExpired(
  item: BroadcastItem,
  now = Date.now(),
): boolean {
  const expires = Date.parse(item.expiresAt);
  if (!Number.isFinite(expires)) {
    return false;
  }
  return expires <= now;
}
