/**
 * 端到端命令通道（主人 → 小狗）。
 *
 * 复用 relay 的 command.send / command.reply 两种白名单 kind，payload 用配对密钥
 * 加密（服务器只见密文）。小狗端收到命令后用本机 qiDevice 执行并回传结果。
 * 不做后台轮询：只在 App 处于 ready 且前台时由 QiProvider 维持一条长轮询。
 */
import {api} from '../net/ApiClient';
import {openJson, sealJson} from '../crypto/Crypto';
import type {PairSummary} from '../data/pairTypes';
import {qiDevice} from '../native/QiDevice';

export type CommandKind =
  | 'guard.status'
  | 'guard.tier'
  | 'usage.stats'
  | 'screen.capture'
  | 'screenshot.status'
  | 'location.get'
  | 'notifications.drain'
  | 'overlay.show'
  | 'audit.recent';

export interface CommandRequest {
  id: string;
  kind: CommandKind;
  args?: Record<string, unknown>;
  at: number;
}

export interface CommandReply {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  at: number;
}

export interface RelayItem {
  seq: number;
  fromDevice: string;
  toDevice: string;
  kind: string;
  ciphertext: string;
  createdAt: string;
}

export interface RelayPage {
  items: RelayItem[];
  cursor: number;
}

const waiters = new Map<string, (reply: CommandReply) => void>();

export function newCommandId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function sendCommand(
  pair: PairSummary,
  kind: CommandKind,
  args?: Record<string, unknown>,
  timeoutMs = 25_000,
): Promise<CommandReply> {
  if (!pair.peerPubkey) {
    throw new Error('对方公钥缺失，无法建立加密通道');
  }
  const request: CommandRequest = {
    id: newCommandId(),
    kind,
    args,
    at: Date.now(),
  };
  const envelope = await sealJson(pair.pairId, pair.peerPubkey, request);
  const result = new Promise<CommandReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(request.id);
      reject(new Error('对方没有响应，可能离线或未授权'));
    }, timeoutMs);
    waiters.set(request.id, reply => {
      clearTimeout(timer);
      resolve(reply);
    });
  });
  try {
    await api('/api/v1/relay/send', {
      method: 'POST',
      body: {
        kind: 'command.send',
        ciphertext: JSON.stringify(envelope),
      },
    });
  } catch (error) {
    waiters.delete(request.id);
    throw error;
  }
  return result;
}

export interface CommandPolicy {
  allowOverlay: boolean;
  allowUsage: boolean;
}

/** 小狗端：执行一条命令并回传结果。返回是否处理了该消息。 */
export async function executeCommand(
  pair: PairSummary,
  item: RelayItem,
  policy: CommandPolicy = {allowOverlay: true, allowUsage: true},
): Promise<boolean> {
  if (item.kind !== 'command.send' || !pair.peerPubkey) {
    return false;
  }
  let request: CommandRequest;
  try {
    request = await openJson<CommandRequest>(pair.pairId, pair.peerPubkey, JSON.parse(item.ciphertext));
  } catch {
    return true;
  }
  let reply: CommandReply;
  try {
    const data = await runLocalCommand(request, policy);
    reply = {id: request.id, ok: true, data, at: Date.now()};
  } catch (error: any) {
    reply = {
      id: request.id,
      ok: false,
      error: error?.message ?? '执行失败',
      at: Date.now(),
    };
  }
  const envelope = await sealJson(pair.pairId, pair.peerPubkey, reply);
  await api('/api/v1/relay/send', {
    method: 'POST',
    body: {kind: 'command.reply', ciphertext: JSON.stringify(envelope)},
  }).catch(() => undefined);
  return true;
}

async function runLocalCommand(
  request: CommandRequest,
  policy: CommandPolicy,
): Promise<unknown> {
  const args = request.args ?? {};
  switch (request.kind) {
    case 'usage.stats':
      if (!policy.allowUsage) {
        throw new Error('小狗端关闭了「使用时长」共享');
      }
      return qiDevice.usage.aggregate();
    case 'overlay.show':
      if (!policy.allowOverlay) {
        throw new Error('小狗端关闭了「全屏消息」');
      }
      return qiDevice.overlay.show(
        String(args.message ?? ''),
        Number(args.timeoutMs) || 15000,
      );
    case 'guard.status':
      return qiDevice.guard.status();
    case 'guard.tier':
      return qiDevice.guard.setTier(String(args.tier) as never);
    case 'screen.capture': {
      const status = await qiDevice.screenshot.status();
      if (!status.canCapture) {
        throw new Error('小狗端还没有开启屏幕共享');
      }
      return qiDevice.screenshot.capture();
    }
    case 'screenshot.status':
      return qiDevice.screenshot.status();
    case 'location.get':
      return qiDevice.location.getLastKnown();
    case 'notifications.drain':
      return qiDevice.notifications.drain(Number(args.limit) || 50);
    case 'audit.recent':
      return qiDevice.audit.read(Number(args.limit) || 20, 0);
    default:
      throw new Error(`未知命令：${request.kind}`);
  }
}

/** 主人端：把收到的回复交给等待中的请求。 */
export async function handleReply(
  pair: PairSummary,
  item: RelayItem,
): Promise<boolean> {
  if (item.kind !== 'command.reply' || !pair.peerPubkey) {
    return false;
  }
  try {
    const reply = await openJson<CommandReply>(
      pair.pairId,
      pair.peerPubkey,
      JSON.parse(item.ciphertext),
    );
    const waiter = waiters.get(reply.id);
    if (waiter) {
      waiters.delete(reply.id);
      waiter(reply);
    }
  } catch {
    // 解不开的回复（例如换过密钥）直接丢弃。
  }
  return true;
}

export async function pollRelay(cursor: number, waitSeconds: number): Promise<RelayPage> {
  return api<RelayPage>(`/api/v1/relay/poll?cursor=${cursor}&wait=${waitSeconds}`);
}
