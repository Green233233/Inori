import {ApiError} from '../src/net/ApiClient';
import {
  COUPON_CODE_LENGTH,
  describeRedeemError,
  displayCouponCode,
  normalizeCouponInput,
} from '../src/data/couponApi';

describe('卡密归一化 normalizeCouponInput', () => {
  it('小写输入自动大写，并在第 7 位补 ·', () => {
    const result = normalizeCouponInput('abcdefg1234567');
    expect(result).toEqual({
      normalized: 'ABCDEFG1234567',
      display: 'ABCDEFG·1234567',
    });
  });

  it('接受已经带 · 的展示格式，归一化后不含分隔符', () => {
    expect(normalizeCouponInput('ABCDEFG·1234567')).toEqual({
      normalized: 'ABCDEFG1234567',
      display: 'ABCDEFG·1234567',
    });
  });

  it('过滤 -、.、空格等分隔符', () => {
    expect(normalizeCouponInput('abc-defg.123 4567').normalized).toBe(
      'ABCDEFG1234567',
    );
    expect(normalizeCouponInput('ABC DEFG 1234567').display).toBe(
      'ABCDEFG·1234567',
    );
    expect(normalizeCouponInput('ABC.DEFG-1234567').display).toBe(
      'ABCDEFG·1234567',
    );
  });

  it('兼容全角字母、数字、连字符与全角中点', () => {
    const result = normalizeCouponInput('ａｂｃｄｅｆｇ－１２３４５６７');
    expect(result.normalized).toBe('ABCDEFG1234567');
    expect(result.display).toBe('ABCDEFG·1234567');
    expect(normalizeCouponInput('ABCDEFG･1234567').normalized).toBe(
      'ABCDEFG1234567',
    );
  });

  it('超长输入截断到 14 位', () => {
    const result = normalizeCouponInput('ABCDEFG1234567XYZ999');
    expect(result.normalized).toHaveLength(COUPON_CODE_LENGTH);
    expect(result.normalized).toBe('ABCDEFG1234567');
    expect(result.display).toBe('ABCDEFG·1234567');
  });

  it('不足 7 位时不加 ·，输入无效字符时返回空串', () => {
    expect(normalizeCouponInput('abc').display).toBe('ABC');
    expect(normalizeCouponInput('abcdefg').display).toBe('ABCDEFG');
    expect(normalizeCouponInput('abcdefg1').display).toBe('ABCDEFG·1');
    expect(normalizeCouponInput('   ···-  ')).toEqual({
      normalized: '',
      display: '',
    });
    expect(normalizeCouponInput(null as unknown as string)).toEqual({
      normalized: '',
      display: '',
    });
  });

  it('displayCouponCode 可重复调用（幂等）', () => {
    expect(displayCouponCode('ABCDEFG1234567')).toBe('ABCDEFG·1234567');
    expect(displayCouponCode('ABCDEFG·1234567')).toBe('ABCDEFG·1234567');
    expect(displayCouponCode('')).toBe('');
  });
});

describe('describeRedeemError 三态映射', () => {
  it('already_used → 琥珀色「已经用过」', () => {
    const failure = describeRedeemError(
      new ApiError(409, 'already_used', '该卡密已于 2026-11-16 核销'),
    );
    expect(failure.tone).toBe('amber');
    expect(failure.code).toBe('already_used');
    expect(failure.message).toContain('核销');
  });

  it('signature_invalid / not_found / invalid_format → 红色', () => {
    expect(
      describeRedeemError(new ApiError(409, 'signature_invalid', '签名不对'))
        .tone,
    ).toBe('red');
    expect(
      describeRedeemError(new ApiError(404, 'not_found', '不存在')).tone,
    ).toBe('red');
    expect(
      describeRedeemError(new ApiError(400, 'invalid_format', '格式不对'))
        .tone,
    ).toBe('red');
  });

  it('未知错误也返回可展示文案，不会抛异常', () => {
    const failure = describeRedeemError(new Error('boom'));
    expect(failure.tone).toBe('red');
    expect(failure.message).toBe('boom');
  });
});
