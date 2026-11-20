/**
 * 绑定码的本地规范化。
 *
 * 绑定码是 8 位大写字母 + 数字（`security.random_pair_code()`），但用户
 * 从微信粘过来时常带空格、短横线或小写。服务端只认严格格式，所以发送前
 * 在本地统一：去掉所有非字母数字、转大写、最多 8 位。
 *
 * 不做「补零」「纠错」之类的聪明事：绑定码错了就必须让用户重新看一眼，
 * 猜错会让人以为自己输对了却加入失败。
 */
const CODE_LENGTH = 8;

export function normalizePairCode(raw: string): string {
  const cleaned = raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  return cleaned.slice(0, CODE_LENGTH);
}

export function isPairCodeComplete(raw: string): boolean {
  return normalizePairCode(raw).length === CODE_LENGTH;
}
