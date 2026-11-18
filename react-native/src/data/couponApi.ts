/**
 * 和好券（P5）客户端契约：类型化网络封装 + 卡密归一化 + 错误三态映射。
 *
 * 服务端卡密格式是 ``ABCDEFG·1234567``（7 位大写字母 + 7 位数字）。用户输入
 * 允许小写、空格、``.`` / ``-`` / ``·`` 以及全角字符，这里统一归一化后再
 * 交给服务端。服务端本身也宽松，但前端实时归一化体验更好（输入框里直接成型）。
 */
import type {Coupon} from './pairTypes';
import {ApiError, api, errorMessage} from '../net/ApiClient';

export type CouponType = 'hehao' | 'exam' | 'reward';
export type CouponStatus = 'unused' | 'used';
export type CouponStatusFilter = 'all' | CouponStatus;
export type CouponTypeFilter = 'all' | CouponType;

export const COUPON_MIN_COUNT = 1;
export const COUPON_MAX_COUNT = 50;
/** 归一化后的卡密长度：7 位字母 + 7 位数字。 */
export const COUPON_CODE_LENGTH = 14;
/** 展示格式在第 7 位后插入 ``·``。 */
export const COUPON_CODE_SPLIT = 7;

export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  hehao: '和好券',
  exam: '考试免罚券',
  reward: '奖励券',
};

/** 只有奖励券是「小狗派发、主人核销」，方向与其他券相反。 */
export function isRewardCoupon(type: string | null | undefined): boolean {
  return type === 'reward';
}

export const COUPON_STATUS_LABELS: Record<CouponStatus, string> = {
  unused: '可用',
  used: '已用',
};

export interface GenerateCouponsInput {
  type: CouponType;
  count: number;
  /** 已加密的备注信封（``JSON.stringify({n, c})``）。 */
  noteCipher?: string;
}

export interface ListCouponsQuery {
  status?: CouponStatusFilter;
  type?: CouponTypeFilter;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface CouponPage {
  total: number;
  limit: number;
  offset: number;
  items: Coupon[];
}

export interface CouponKeyInfo {
  algorithm: string;
  publicKeyPem: string;
  fingerprint: string;
  version: string;
}

export interface CouponAuditEntry {
  at: string;
  atDisplay: string | null;
  actor: string;
  action: string;
  detail: string | null;
}

export interface CouponVerifyResult {
  exists: boolean;
  signatureValid: boolean;
  status: CouponStatus | null;
  coupon: Coupon | null;
  message: string;
}

export type CouponTone = 'green' | 'amber' | 'red';

/** 三态文案：绿=真实可用，琥珀=已被使用，红=伪造/不存在。 */
export interface CouponBanner {
  tone: CouponTone;
  title: string;
  message: string;
}

export interface RedeemFailure extends CouponBanner {
  tone: 'amber' | 'red';
  code: string;
}

/* ------------------------------------------------------------------ */
/* 卡密归一化                                                          */
/* ------------------------------------------------------------------ */

const FULL_WIDTH_OFFSET = 0xfee0;

function halfWidthChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  // 全角 ASCII（！..～）与全角空格。
  if (code >= 0xff01 && code <= 0xff5e) {
    return String.fromCharCode(code - FULL_WIDTH_OFFSET);
  }
  if (code === 0x3000) {
    return ' ';
  }
  // 各种中点/间隔号统一成一个可被过滤掉的符号，便于 display 重建。
  if (
    code === 0x00b7 ||
    code === 0x2022 ||
    code === 0x2027 ||
    code === 0x2219 ||
    code === 0x30fb ||
    code === 0xff65
  ) {
    return '·';
  }
  return ch;
}

/** 从任意输入得到 ``{normalized, display}``；无有效字符时两者都是空串。 */
export function normalizeCouponInput(raw: string): {
  normalized: string;
  display: string;
} {
  const half = Array.from(String(raw ?? ''))
    .map(halfWidthChar)
    .join('');
  const normalized = half
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, COUPON_CODE_LENGTH);
  return {normalized, display: displayCouponCode(normalized)};
}

/** 把已归一化的 14 位卡密渲染成 ``ABCDEFG·1234567``。 */
export function displayCouponCode(normalized: string): string {
  const value = String(normalized ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, COUPON_CODE_LENGTH);
  if (value.length <= COUPON_CODE_SPLIT) {
    return value;
  }
  return `${value.slice(0, COUPON_CODE_SPLIT)}·${value.slice(COUPON_CODE_SPLIT)}`;
}

export function couponStatusLabel(status: CouponStatus | null): string {
  return status ? COUPON_STATUS_LABELS[status] : '未知';
}

export function couponTypeLabel(type: CouponType | string): string {
  return COUPON_TYPE_LABELS[type as CouponType] ?? String(type);
}

/* ------------------------------------------------------------------ */
/* 网络封装                                                            */
/* ------------------------------------------------------------------ */

function buildQuery(query: ListCouponsQuery): string {
  const params: string[] = [];
  if (query.status && query.status !== 'all') {
    params.push(`status=${encodeURIComponent(query.status)}`);
  }
  if (query.type && query.type !== 'all') {
    params.push(`type=${encodeURIComponent(query.type)}`);
  }
  const search = (query.q ?? '').trim();
  if (search) {
    params.push(`q=${encodeURIComponent(search)}`);
  }
  if (typeof query.limit === 'number') {
    params.push(`limit=${Math.max(1, Math.min(100, Math.round(query.limit)))}`);
  }
  if (typeof query.offset === 'number') {
    params.push(`offset=${Math.max(0, Math.round(query.offset))}`);
  }
  return params.length > 0 ? `?${params.join('&')}` : '';
}

export async function generateCoupons(
  input: GenerateCouponsInput,
): Promise<Coupon[]> {
  const count = Math.min(
    COUPON_MAX_COUNT,
    Math.max(COUPON_MIN_COUNT, Math.round(input.count)),
  );
  const body: {type: CouponType; count: number; noteCipher?: string} = {
    type: input.type,
    count,
  };
  if (input.noteCipher) {
    body.noteCipher = input.noteCipher;
  }
  const response = await api<{ok: true; coupons: Coupon[]}>('/api/v1/coupons', {
    method: 'POST',
    body,
  });
  return response.coupons ?? [];
}

export async function listCoupons(
  query: ListCouponsQuery = {},
): Promise<CouponPage> {
  const response = await api<{
    ok: true;
    total: number;
    limit: number;
    offset: number;
    items: Coupon[];
  }>(`/api/v1/coupons${buildQuery(query)}`);
  return {
    total: response.total ?? 0,
    limit: response.limit ?? 0,
    offset: response.offset ?? 0,
    items: response.items ?? [],
  };
}

export async function getKeyInfo(): Promise<CouponKeyInfo> {
  const response = await api<{ok: true} & CouponKeyInfo>(
    '/api/v1/coupons/keyinfo',
  );
  return {
    algorithm: response.algorithm,
    publicKeyPem: response.publicKeyPem,
    fingerprint: response.fingerprint,
    version: response.version,
  };
}

export async function getAudit(limit = 20): Promise<CouponAuditEntry[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
  const response = await api<{ok: true; items: CouponAuditEntry[]}>(
    `/api/v1/coupons/audit?limit=${safeLimit}`,
  );
  return response.items ?? [];
}

/** 只验不耗：返回是否存在、签名是否有效、状态，以及券面数据。 */
export async function verifyCoupon(code: string): Promise<CouponVerifyResult> {
  const {normalized} = normalizeCouponInput(code);
  const response = await api<{
    ok: true;
    exists: boolean;
    signatureValid: boolean;
    status: CouponStatus | null;
    coupon: Coupon | null;
    message: string;
  }>('/api/v1/coupons/verify', {
    method: 'POST',
    body: {code: normalized},
  });
  return {
    exists: !!response.exists,
    signatureValid: !!response.signatureValid,
    status: response.status ?? null,
    coupon: response.coupon ?? null,
    message: response.message ?? '',
  };
}

/** 核销（不可逆）。失败时抛 ``ApiError``，用 ``describeRedeemError`` 转文案。 */
export async function redeemCoupon(
  code: string,
  noteCipher?: string,
): Promise<Coupon> {
  const {normalized} = normalizeCouponInput(code);
  const body: {code: string; noteCipher?: string} = {code: normalized};
  if (noteCipher) {
    body.noteCipher = noteCipher;
  }
  const response = await api<{ok: true; coupon: Coupon}>(
    '/api/v1/coupons/redeem',
    {method: 'POST', body},
  );
  return response.coupon;
}

/* ------------------------------------------------------------------ */
/* 错误 / 结果文案                                                     */
/* ------------------------------------------------------------------ */

/**
 * 核销失败三态：
 * - 409 already_used → 琥珀（券是真的，只是用过了）；
 * - 409 signature_invalid / 404 not_found → 红（伪造）；
 * - 400 invalid_format → 红（输入问题，给格式提示）。
 */
export function describeRedeemError(error: unknown): RedeemFailure {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'already_used':
        return {
          tone: 'amber',
          code: error.code,
          title: '这张券已经用过了',
          message: error.message || '每张券只能核销一次。',
        };
      case 'signature_invalid':
        return {
          tone: 'red',
          code: error.code,
          title: '签名校验失败',
          message: '签名对不上，这张券不是主人端签发的，疑似伪造。',
        };
      case 'not_found':
        return {
          tone: 'red',
          code: error.code,
          title: '找不到这张卡密',
          message: '服务器没有这张券，可能是伪造的，或者卡密输错了。',
        };
      case 'invalid_format':
        return {
          tone: 'red',
          code: error.code,
          title: '卡密格式不对',
          message: '卡密是 7 位字母 + 7 位数字，例如 ABCDEFG·1234567。',
        };
      default:
        break;
    }
    return {
      tone: 'red',
      code: error.code,
      title: '核销失败',
      message: errorMessage(error),
    };
  }
  return {
    tone: 'red',
    code: 'unknown',
    title: '核销失败',
    message: errorMessage(error),
  };
}

/** 校验结果三态文案。 */
export function describeVerifyResult(result: CouponVerifyResult): CouponBanner {
  const coupon = result.coupon;
  if (!result.exists || !coupon) {
    return {
      tone: 'red',
      title: '查不到这张券',
      message: result.message || '服务器没有这张卡密，疑似伪造。',
    };
  }
  if (!result.signatureValid) {
    return {
      tone: 'red',
      title: '签名校验失败',
      message: result.message || '这张券的签名对不上，疑似伪造。',
    };
  }
  if (result.status === 'used') {
    return {
      tone: 'amber',
      title: '已被使用',
      message: coupon.usedAtDisplay
        ? `已于 ${coupon.usedAtDisplay} 核销。`
        : result.message || '这张券已经用过一次了。',
    };
  }
  return {
    tone: 'green',
    title: '真实有效',
    message: result.message || '签名有效，还没被用过，可以核销。',
  };
}
