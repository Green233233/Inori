/**
 * 应用限制的下发与回执。
 *
 * 三种消息都走同一条加密中继（服务端只存密文）：
 *  - 主人保存名单 → `app.limit`（payload = 名单，不含本地 updatedAt）
 *  - 小狗收到并把名单写进原生 → `app.limit.ack`（payload = 生效时间）
 *  - 小狗自己在「权限管控中心」关掉 → 同样是 `app.limit`，但 `enabled=false`
 *
 * 为什么不交给原生常驻服务：`QiLinkService` 只处理只读命令（定位/使用时长/
 * 权限快照），写状态的指令必须留在 JS 里，否则会出现「原生先写一次、JS 又写
 * 一次」的双写竞态。见 `isHandledByNative` 的注释。
 */
import {api} from '../net/ApiClient';
import {sealJson, openJson} from '../crypto/Crypto';
import type {PairSummary} from '../data/pairTypes';
import {qiLimits, toWireRules} from '../native/QiLimits';
import type {AppLimitEntry, AppLimitRules} from '../native/QiLimits';

const KIND_LIMIT = 'app.limit';
const KIND_ACK = 'app.limit.ack';

/** 复用 commands.ts 的 RelayItem 形状（只用到 kind / ciphertext）。 */
interface RelayItem {
  kind: string;
  ciphertext: string;
}

function peerKey(pair: PairSummary): string {
  if (!pair.peerPubkey) {
    throw new Error('对方公钥缺失，无法建立加密通道');
  }
  return pair.peerPubkey;
}

async function send(
  pair: PairSummary,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const envelope = await sealJson(pair.pairId, peerKey(pair), payload);
  await api('/api/v1/relay/send', {
    method: 'POST',
    body: {kind, ciphertext: JSON.stringify(envelope)},
  });
}

/** 主人端：把名单推给小狗端（也用于小狗端主动关掉限制时回报）。 */
export async function sendAppLimit(
  pair: PairSummary,
  rules: AppLimitRules,
): Promise<void> {
  await send(pair, KIND_LIMIT, {...toWireRules(rules), at: Date.now()});
}

/** 小狗端：确认已落到原生，并回报生效时间。 */
export async function ackAppLimit(
  pair: PairSummary,
  appliedAt: number,
): Promise<void> {
  await send(pair, KIND_ACK, {appliedAt});
}

function normalizeRules(input: any): AppLimitRules {
  const blocked: AppLimitEntry[] = Array.isArray(input?.blocked)
    ? input.blocked
        .map((item: any) => ({
          pkg: typeof item?.pkg === 'string' ? item.pkg.trim() : '',
          label: typeof item?.label === 'string' ? item.label.trim() : '',
        }))
        .filter((item: AppLimitEntry) => item.pkg !== '')
    : [];
  return {
    enabled: input?.enabled === true,
    blocked,
    updatedAt: typeof input?.at === 'number' ? input.at : Date.now(),
  };
}

export interface AppLimitInboxResult {
  /** 小狗端写入原生是否成功；主人端收到 ack 时恒为 false。 */
  applied: boolean;
  /** 收到的是主人的新名单（true）还是小狗的确认（false）。 */
  isRules: boolean;
  rules?: AppLimitRules;
}

/**
 * 小狗端：收到主人的名单后写入原生，然后回一条 ack。
 * 主人端：收到 ack 时只需要刷新一下状态，不做别的。
 */
export async function handleAppLimit(
  pair: PairSummary,
  item: RelayItem,
): Promise<AppLimitInboxResult> {
  const envelope = JSON.parse(item.ciphertext);
  const payload: any = await openJson(pair.pairId, peerKey(pair), envelope);

  if (item.kind === KIND_ACK) {
    return {applied: false, isRules: false};
  }

  const rules = normalizeRules(payload);
  const applied = await qiLimits.setRules(rules).catch(() => false);
  await ackAppLimit(pair, applied ? rules.updatedAt : 0).catch(() => undefined);
  return {applied, isRules: true, rules};
}
