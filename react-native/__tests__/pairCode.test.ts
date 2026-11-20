import {
  isPairCodeComplete,
  normalizePairCode,
} from '../src/features/pair/pairCode';

describe('normalizePairCode', () => {
  it('转大写并去掉空格与短横线', () => {
    expect(normalizePairCode('ab c d-ef12')).toBe('ABCDEF12');
  });

  it('去掉全角空格和中文标点', () => {
    expect(normalizePairCode('AB　CD，EF12')).toBe('ABCDEF12');
  });

  it('超过 8 位只留前 8 位', () => {
    expect(normalizePairCode('ABCDEF12345')).toBe('ABCDEF12');
  });

  it('不足 8 位原样保留（不做补零）', () => {
    expect(normalizePairCode('ab c')).toBe('ABC');
  });

  it('空字符串与非字母数字返回空串', () => {
    expect(normalizePairCode('')).toBe('');
    expect(normalizePairCode('   - - ')).toBe('');
  });
});

describe('isPairCodeComplete', () => {
  it('正好 8 位字母数字才算完整', () => {
    expect(isPairCodeComplete('PERWTCF9')).toBe(true);
    expect(isPairCodeComplete('perw tcf9')).toBe(true);
    expect(isPairCodeComplete('PERWTCF')).toBe(false);
    expect(isPairCodeComplete('')).toBe(false);
  });
});
