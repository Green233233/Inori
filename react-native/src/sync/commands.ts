/**
 * 端到端命令通道（主人 → 小狗）。
 *
 * 复用 relay 的 command.send / command.reply 两种白名单 kind，payload 用配对密钥
 * 加密（服务器只见密文）。小狗端收到命令后用本机 qiDevice 执行并回传结果。
 * 不做后台轮询：只在 App 处于 ready 且前台时由 QiProvider 维持一条长轮询。
 */
import {PermissionsAndroid, Platform} from 'react-native';

import {api} from '../net/ApiClient';
import {openJson, sealJson} from '../crypto/Crypto';
import type {PairSummary} from '../data/pairTypes';
import {qiDevice, type LocationFix} from '../native/QiDevice';

export type CommandKind =
  | 'guard.status'
  | 'guard.tier'
  | 'guard.lock'
  | 'usage.stats'
  | 'usage.day'
  | 'usage.range'
  | 'usage.sessions'
  | 'apps.list'
  | 'screen.capture'
  | 'screenshot.status'
  | 'location.get'
  | 'notifications.drain'
  | 'overlay.show'
  | 'permissions.snapshot'
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

/**
 * location.get 的回传形状：在原生 LocationFix 上补一段可读地址。
 *
 * `address` 一定非空（逆地理失败时退回「纬度,经度」），UI 可以直接把它当主
 * 文案；`addressSource` 让界面知道该不该把经纬度再显示成小字。
 */
export interface LocatedPlace extends LocationFix {
  address?: string;
  addressSource?: 'geocoder' | 'coordinates';
  geoUri?: string;
}

const waiters = new Map<string, (reply: CommandReply) => void>();

export function newCommandId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function sendCommand(
  pair: PairSummary,
  kind: CommandKind,
  args?: Record<string, unknown>,
  timeoutMs = 40_000,
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
      reject(new Error('对方没有响应哦，可能离线或未授权呀'));
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
    if (request.kind === 'location.get') {
      notifyLocationViewed(data);
    }
  } catch (error: any) {
    reply = {
      id: request.id,
      ok: false,
      error: error?.message ?? '执行失败了qwq',
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

/**
 * 给一次定位结果补中文地址。
 *
 * 优先原生 Geocoder（LocationModule 内部优先 getAddressLine(0)，空则用
 * 省/市/区/街道拼接）；逆地理需要网络，失败绝不能把整条定位请求判失败，所以
 * 最后退回「纬度,经度」，并始终给出一个 `geo:` 链接供 UI 打开系统地图。
 */
async function describeFix(fix: LocationFix): Promise<LocatedPlace> {
  const lat = Number(fix?.lat);
  const lng = Number(fix?.lng);
  if (!fix?.ok || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fix;
  }
  const coordinateText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  let address = '';
  try {
    const geocoded = await qiDevice.location.reverseGeocode(lat, lng);
    if (geocoded?.ok) {
      address = String(geocoded.address ?? '').trim();
    }
  } catch {
    // 没有网络/ROM 不带逆地理服务：只是少了好看的文案，坐标仍然可用。
  }
  const fromGeocoder = address.length > 0;
  if (!fromGeocoder) {
    address = coordinateText;
  }
  return {
    ...fix,
    address,
    addressSource: fromGeocoder ? 'geocoder' : 'coordinates',
    geoUri: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(address)})`,
  };
}

/**
 * 被查看的一方留一条通知：位置被读取不需要本人确认，但必须让他知道。
 *
 * 只在真正取到坐标时发；无权限/无网络/执行失败都不打扰。通知失败（旧包没有
 * QiNotice、系统限制）也绝不能反过来把定位回传判失败。
 */
function notifyLocationViewed(data: unknown): void {
  const place = data as Partial<LocatedPlace> | null | undefined;
  const lat = Number(place?.lat);
  const lng = Number(place?.lng);
  if (place?.ok === false || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }
  try {
    qiDevice.notice
      .post('qi.location.viewed', '祈 · 位置', '小狗刚刚查看了你的位置哦', false)
      .catch(() => undefined);
  } catch {
    // 没有通知模块：静默跳过。
  }
}

/** 本地时区的今天 0 点：usage.day 没带 dayStartMs 时的缺省窗口。 */
function startOfToday(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
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
    case 'usage.day': {
      if (!policy.allowUsage) {
        throw new Error('小狗端关闭了「使用时长」共享');
      }
      const dayStartMs = Number(args.dayStartMs);
      return qiDevice.usage.dayStats(
        Number.isFinite(dayStartMs) ? dayStartMs : startOfToday(),
      );
    }
    case 'usage.range':
      if (!policy.allowUsage) {
        throw new Error('小狗端关闭了「使用时长」共享');
      }
      return qiDevice.usage.rangeStats(Number(args.days) || 7);
    case 'usage.sessions': {
      if (!policy.allowUsage) {
        throw new Error('小狗端关闭了「使用时长」共享');
      }
      const toMs = Number(args.toMs);
      const fromMs = Number(args.fromMs);
      const end = Number.isFinite(toMs) ? toMs : Date.now();
      // 默认看最近 24 小时：主人端轨迹时间轴最常用的窗口。
      const start = Number.isFinite(fromMs) ? fromMs : end - 24 * 60 * 60 * 1000;
      return qiDevice.usage.sessions(start, end);
    }
    case 'apps.list':
      // 应用清单不是「使用数据」，不受 allowUsage 门控；主人的使用时长页用它
      // 把 pkg 补成中文名。
      return qiDevice.usage.installedApps();
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
    case 'guard.lock':
      return qiDevice.guard.lockNow();
    case 'screen.capture': {
      const status = await qiDevice.screenshot.status();
      if (!status.canCapture) {
        throw new Error('小狗端还没有开启屏幕共享哦');
      }
      return qiDevice.screenshot.capture();
    }
    case 'screenshot.status':
      return qiDevice.screenshot.status();
    case 'location.get':
      await ensureLocationPermission();
      return describeFix(await qiDevice.location.locate());
    case 'notifications.drain':
      return qiDevice.notifications.drain(Number(args.limit) || 50);
    case 'permissions.snapshot':
      return qiDevice.permissions.snapshot();
    case 'audit.recent':
      return qiDevice.audit.read(Number(args.limit) || 20, 0);
    default:
      throw new Error(`未知命令：${request.kind}`);
  }
}

/**
 * 取点前先确认定位权限：对方第一次点「定位」时，被查看的一端会弹一次系统授权，
 * 同意后就再也不用弹了（拒绝时仍走 locate 的 no_permission 分支）。
 */
async function ensureLocationPermission(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    const fine = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (fine) {
      return;
    }
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]);
  } catch {
    // 权限请求本身失败就交给 locate 报 no_permission。
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

/**
 * 把这一批 relay 消息标记成「已处理」。
 *
 * 服务端只在收到 ack 之后才会删除这些行（`relay.cleanup`），否则它们会一直
 * 留在表里；更糟的是游标为 0（比如刚换设备、本地游标丢了）时，服务端会把
 * 最多 50 条未 ack 的旧指令重新发一遍，只读命令就会被重复执行。所以每处理
 * 完一页都要回一个 ack。失败不抛：下轮会重新收到并再次 ack。
 */
export async function ackRelay(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  await api('/api/v1/relay/ack', {
    method: 'POST',
    body: {seqs},
    // ack 很小，和长轮询分开给个短超时，别让它拖住循环。
    timeoutMs: 10_000,
  });
}

export async function pollRelay(cursor: number, waitSeconds: number): Promise<RelayPage> {
  // 服务端会把请求 hold 住 waitSeconds 秒（长轮询）。这里必须给足超时，
  // 否则默认 15s 会在服务端还等着的时候先断开，空闲时每轮都超时，
  // 退避时间一路涨到 60s，命令就会被误判成「对方没有响应」。
  const timeoutMs = (waitSeconds + 10) * 1000;
  return api<RelayPage>(`/api/v1/relay/poll?cursor=${cursor}&wait=${waitSeconds}`, {
    timeoutMs,
  });
}
