import {encodeBase64, decodeBase64} from '../src/crypto/base64';

describe('base64 / UTF-8 bridge', () => {
  it('encodes ASCII', () => {
    expect(encodeBase64('hello')).toBe('aGVsbG8=');
    expect(decodeBase64('aGVsbG8=')).toBe('hello');
  });

  it('encodes Chinese', () => {
    const text = '祈 · 联结';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('round-trips emoji (surrogate pairs)', () => {
    const text = '小不点儿🐶🌸';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('round-trips JSON payloads', () => {
    const payload = JSON.stringify({
      kind: 'command.send',
      text: '记得喝水',
      nested: {n: 1, ok: true},
    });
    expect(JSON.parse(decodeBase64(encodeBase64(payload)))).toEqual(
      JSON.parse(payload),
    );
  });

  it('ignores whitespace in input', () => {
    expect(decodeBase64('aGVs bG8=\n')).toBe('hello');
  });
});
