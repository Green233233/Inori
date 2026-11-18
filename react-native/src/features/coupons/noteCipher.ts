/**
 * 券备注的端到端加密。
 *
 * 备注先用配对密钥 ``sealJson`` 成 ``{n, c}`` 信封，再整体 ``JSON.stringify``
 * 成字符串作为 ``noteCipher`` 交给服务器 —— 服务器只看得到密文。展示时用
 * ``openNote`` 解回；解绑、换设备或密钥不匹配时返回 ``null``，由 UI 降级成
 * 「无法解密」，绝不让解密失败把页面打崩。
 */
import {openJson, sealJson} from '../../crypto/Crypto';
import type {PairSummary} from '../../data/pairTypes';

/** 备注明文上限；服务端按密文字节限制 8KB，200 字符远低于上限。 */
export const NOTE_MAX_LENGTH = 200;
export const NOTE_LOCKED_TEXT = '无法解密';

export interface NoteTarget {
  pairId: string | null;
  peerPubkey: string | null;
}

export function noteTargetFrom(pair: PairSummary | null): NoteTarget {
  return {
    pairId: pair?.pairId ?? null,
    peerPubkey: pair?.peerPubkey ?? null,
  };
}

export function canEncryptNote(target: NoteTarget): boolean {
  return !!target.pairId && !!target.peerPubkey;
}

interface NotePayload {
  v?: number;
  text?: string;
}

/** 加密一段备注明文，返回服务器可存的 ``noteCipher`` 字符串。 */
export async function sealNote(
  target: NoteTarget,
  text: string,
): Promise<string> {
  const trimmed = text.trim().slice(0, NOTE_MAX_LENGTH);
  if (!trimmed) {
    throw new Error('备注是空的');
  }
  if (!target.pairId || !target.peerPubkey) {
    throw new Error('还没有对方的公钥，暂时不能加密备注');
  }
  const envelope = await sealJson(target.pairId, target.peerPubkey, {
    v: 1,
    text: trimmed,
  });
  return JSON.stringify(envelope);
}

/**
 * 解开 ``noteCipher``；没有密文、缺少密钥或解密失败都返回 ``null``。
 * 调用方只在密文存在时把 ``null`` 当作「无法解密」。
 */
export async function openNote(
  target: NoteTarget,
  cipher: string | null | undefined,
): Promise<string | null> {
  if (!cipher || !target.pairId || !target.peerPubkey) {
    return null;
  }
  try {
    const envelope = JSON.parse(cipher) as {n?: unknown; c?: unknown};
    if (typeof envelope?.n !== 'string' || typeof envelope?.c !== 'string') {
      return null;
    }
    const value = await openJson<NotePayload | string>(
      target.pairId,
      target.peerPubkey,
      {n: envelope.n, c: envelope.c},
    );
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object' && typeof value.text === 'string') {
      return value.text;
    }
    return null;
  } catch {
    return null;
  }
}
