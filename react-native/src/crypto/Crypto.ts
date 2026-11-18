/**
 * Pair-scoped encryption helpers.
 *
 * Identity keys live in the native layer; the conversation salt is derived from
 * the pair id, so both devices can compute it without an extra exchange.
 */
import {qiCrypto} from '../native/QiNative';
import {decodeBase64, encodeBase64} from './base64';

export const DEVICE_IDENTITY = 'device';

export function pairSalt(pairId: string): string {
  return encodeBase64(`qi/pair/${pairId}`);
}

export async function ensureIdentity(): Promise<string> {
  const existing = await qiCrypto.identityPublicKey(DEVICE_IDENTITY);
  if (existing) {
    return existing;
  }
  return qiCrypto.createIdentity(DEVICE_IDENTITY);
}

export async function resetIdentity(): Promise<void> {
  await qiCrypto.deleteIdentity(DEVICE_IDENTITY).catch(() => false);
}

export async function sealJson(
  pairId: string,
  peerPublicB64: string,
  value: unknown,
): Promise<{n: string; c: string}> {
  const sealed = await qiCrypto.seal(
    DEVICE_IDENTITY,
    peerPublicB64,
    pairSalt(pairId),
    encodeBase64(JSON.stringify(value)),
  );
  return {n: sealed.nonce, c: sealed.ciphertext};
}

export async function openJson<T>(
  pairId: string,
  peerPublicB64: string,
  envelope: {n: string; c: string},
): Promise<T> {
  const plain = await qiCrypto.open(
    DEVICE_IDENTITY,
    peerPublicB64,
    pairSalt(pairId),
    envelope.n,
    envelope.c,
  );
  return JSON.parse(decodeBase64(plain)) as T;
}

export async function sha256Text(value: string): Promise<string> {
  return qiCrypto.sha256Hex(encodeBase64(value));
}

export async function shortAuthString(
  myPublic: string,
  peerPublic: string,
  pairId: string,
  bindingCode: string,
): Promise<string> {
  const codeHash = await sha256Text(`qi/code/${bindingCode.toUpperCase()}`);
  return qiCrypto.sasCode(myPublic, peerPublic, pairId, codeHash);
}
