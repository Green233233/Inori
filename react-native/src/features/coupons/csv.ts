/**
 * 券记录 CSV 导出（纯函数，便于单测）。
 *
 * 列固定为：卡密,类型,状态,生成时间,核销时间,备注,签名短码。
 * 以 UTF-8 BOM 开头，Excel / Numbers 双击打开不会乱码。
 */
import {encodeBase64} from '../../crypto/base64';
import {
  COUPON_TYPE_LABELS,
  couponStatusLabel,
} from '../../data/couponApi';
import type {Coupon} from '../../data/pairTypes';

export const CSV_HEADER = [
  '卡密',
  '类型',
  '状态',
  '生成时间',
  '核销时间',
  '备注',
  '签名短码',
] as const;

export interface CouponCsvRow {
  coupon: Coupon;
  /** 已解密的备注；无法解密或没有备注时为空。 */
  note: string | null;
}

function escapeCell(value: string): string {
  const text = value ?? '';
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCouponCsv(rows: CouponCsvRow[]): string {
  const lines: string[] = [CSV_HEADER.join(',')];
  rows.forEach(({coupon, note}) => {
    lines.push(
      [
        escapeCell(coupon.code),
        escapeCell(coupon.typeLabel || COUPON_TYPE_LABELS[coupon.type]),
        escapeCell(couponStatusLabel(coupon.status)),
        escapeCell(coupon.createdAtDisplay ?? coupon.createdAt),
        escapeCell(coupon.usedAtDisplay ?? ''),
        escapeCell(note ?? ''),
        escapeCell(coupon.signatureShort),
      ].join(','),
    );
  });
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

/** ``inori-coupons-20261116-2351.csv``（本地时间）。 */
export function couponsCsvFileName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('');
  return `inori-coupons-${stamp}.csv`;
}

export function encodeCsvBase64(csv: string): string {
  return encodeBase64(csv);
}
