/**
 * 券面（纯 View，无动画、无新依赖）。
 *
 * 结构：左侧券根（印章 + 「券根」）｜虚线撕线 + 上下两个半圆缺口｜右侧票身
 * （类型 / 状态 / 卡密 / 时间 / 流水号 / 签名短码）。
 * 缺口用页面底色画两个圆覆盖在撕线上，视觉上就是「咬掉」的形状。
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  COUPON_STATUS_LABELS,
  COUPON_TYPE_LABELS,
} from '../../data/couponApi';
import type {Coupon} from '../../data/pairTypes';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {tabularNums, type} from '../../theme/typography';
import {Pill} from '../../components/Ui';

export interface TicketProps {
  coupon: Coupon;
  compact?: boolean;
  /** 券根缺口的颜色，默认页面底色；嵌在其它底色容器里时可传入容器底色。 */
  notchColor?: string;
}

const TEAR_DASH_COUNT = 9;

export function Ticket({coupon, compact = false, notchColor}: TicketProps) {
  const {colors, surfaces} = useAppTheme();
  const used = coupon.status === 'used';
  const stampColor = used ? colors.onSurfaceVariant : colors.error;
  const cutout = notchColor ?? colors.background;
  const serial = (coupon.serial ?? '').slice(0, 8) || '——';
  const typeLabel = coupon.typeLabel || COUPON_TYPE_LABELS[coupon.type];
  const statusLabel = COUPON_STATUS_LABELS[coupon.status] ?? coupon.status;
  const createdAt = coupon.createdAtDisplay ?? coupon.createdAt;
  const timeLabel =
    used && coupon.usedAtDisplay
      ? `核销 ${coupon.usedAtDisplay}`
      : `签发 ${createdAt}`;

  return (
    <View
      style={[
        styles.ticket,
        {
          backgroundColor: surfaces.raised,
          borderColor: surfaces.highlightSoft,
          opacity: used ? 0.82 : 1,
        },
      ]}>
      <View style={[styles.stub, compact && styles.stubCompact]}>
        <View
          style={[
            styles.stamp,
            compact && styles.stampCompact,
            {borderColor: withAlpha(stampColor, 0.72)},
          ]}>
          <Text
            numberOfLines={1}
            style={[
              styles.stampText,
              compact && styles.stampTextCompact,
              {color: stampColor},
            ]}>
            {used ? '已用' : '祈'}
          </Text>
        </View>
        <Text
          style={[styles.stubLabel, {color: colors.onSurfaceVariant}]}
          numberOfLines={1}>
          券根
        </Text>
      </View>

      <View style={styles.tear}>
        {Array.from({length: TEAR_DASH_COUNT}).map((_, index) => (
          <View
            key={index}
            style={[styles.dash, {backgroundColor: colors.outline}]}
          />
        ))}
        <View
          style={[
            styles.notch,
            styles.notchTop,
            {backgroundColor: cutout},
          ]}
        />
        <View
          style={[
            styles.notch,
            styles.notchBottom,
            {backgroundColor: cutout},
          ]}
        />
      </View>

      <View style={[styles.body, compact && styles.bodyCompact]}>
        <View style={styles.headerRow}>
          <Text
            numberOfLines={1}
            style={[type.headline, styles.typeLabel, {color: colors.onSurface}]}>
            {typeLabel}
          </Text>
          <Pill
            text={statusLabel}
            color={used ? colors.onSurfaceVariant : colors.onSurface}
            background={surfaces.sunken}
          />
        </View>

        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          numberOfLines={1}
          style={[
            styles.code,
            compact && styles.codeCompact,
            tabularNums,
            {color: colors.onSurface},
          ]}>
          {coupon.code}
        </Text>

        <Text
          numberOfLines={1}
          style={[type.caption, styles.time, {color: colors.onSurfaceVariant}]}>
          {timeLabel}
        </Text>

        <View style={styles.metaRow}>
          <Text
            numberOfLines={1}
            style={[
              styles.metaText,
              tabularNums,
              {color: colors.onSurfaceVariant},
            ]}>
            流水 {serial}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.metaText,
              tabularNums,
              {color: colors.onSurfaceVariant},
            ]}>
            签名 {coupon.signatureShort}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: {
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'visible',
  },
  stub: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  stubCompact: {width: 64, paddingVertical: 12, gap: 6},
  stamp: {
    width: 52,
    height: 52,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{rotate: '-8deg'}],
  },
  stampCompact: {width: 38, height: 38, borderRadius: 6, borderWidth: 1.5},
  stampText: {fontSize: 26, fontWeight: '800', letterSpacing: 1},
  stampTextCompact: {fontSize: 12, fontWeight: '800', letterSpacing: 0},
  stubLabel: {fontSize: 9, fontWeight: '600', letterSpacing: 2},
  tear: {
    width: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  dash: {width: 1, height: 5, opacity: 0.55},
  notch: {
    position: 'absolute',
    left: -6,
    width: 13,
    height: 13,
    borderRadius: 6.5,
  },
  notchTop: {top: -6.5},
  notchBottom: {bottom: -6.5},
  body: {flex: 1, paddingHorizontal: 14, paddingVertical: 14, gap: 4},
  bodyCompact: {paddingHorizontal: 11, paddingVertical: 10, gap: 2},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  typeLabel: {flexShrink: 1},
  code: {fontSize: 22, fontWeight: '700', letterSpacing: 1.4, marginTop: 2},
  codeCompact: {fontSize: 18, letterSpacing: 1, marginTop: 0},
  time: {marginTop: 2},
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  metaText: {fontSize: 10, flexShrink: 1, opacity: 0.9},
});

export default Ticket;
