/**
 * Tiny UTF-8 <-> base64 helpers.
 *
 * Hermes has no reliable `btoa`/`atob`/`TextEncoder`, and ciphertext/token
 * payloads must travel through the native bridge as base64. This module is
 * intentionally pure TypeScript so it can be unit-tested with Jest.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = {};
for (let index = 0; index < ALPHABET.length; index += 1) {
  LOOKUP[ALPHABET[index]] = index;
}

export function utf8ToBytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.codePointAt(index) ?? 0;
    if (code > 0xffff) {
      index += 1;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

export function bytesToUtf8(bytes: number[]): string {
  let out = '';
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index++];
    let code: number;
    if (first < 0x80) {
      code = first;
    } else if ((first & 0xe0) === 0xc0) {
      code = ((first & 0x1f) << 6) | (bytes[index++] & 0x3f);
    } else if ((first & 0xf0) === 0xe0) {
      code =
        ((first & 0x0f) << 12) |
        ((bytes[index++] & 0x3f) << 6) |
        (bytes[index++] & 0x3f);
    } else {
      code =
        ((first & 0x07) << 18) |
        ((bytes[index++] & 0x3f) << 12) |
        ((bytes[index++] & 0x3f) << 6) |
        (bytes[index++] & 0x3f);
    }
    if (code > 0xffff) {
      const adjusted = code - 0x10000;
      out += String.fromCharCode(
        0xd800 + (adjusted >> 10),
        0xdc00 + (adjusted & 0x3ff),
      );
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

export function bytesToBase64(bytes: number[]): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += ALPHABET[first >> 2];
    out += ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    out +=
      second === undefined
        ? '='
        : ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    out += third === undefined ? '=' : ALPHABET[third & 0x3f];
  }
  return out;
}

export function base64ToBytes(value: string): number[] {
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4);
    if (chunk.length < 2) {
      break;
    }
    const first = LOOKUP[chunk[0]] ?? 0;
    const second = LOOKUP[chunk[1]] ?? 0;
    bytes.push((first << 2) | (second >> 4));
    if (chunk.length > 2 && chunk[2] !== '=') {
      const third = LOOKUP[chunk[2]] ?? 0;
      bytes.push(((second & 0x0f) << 4) | (third >> 2));
      if (chunk.length > 3 && chunk[3] !== '=') {
        const fourth = LOOKUP[chunk[3]] ?? 0;
        bytes.push(((third & 0x03) << 6) | fourth);
      }
    }
  }
  return bytes;
}

export function encodeBase64(text: string): string {
  return bytesToBase64(utf8ToBytes(text));
}

export function decodeBase64(value: string): string {
  return bytesToUtf8(base64ToBytes(value));
}
