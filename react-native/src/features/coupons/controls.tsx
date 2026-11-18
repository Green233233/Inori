/**
 * 券页面共用的小控件：分段选择、数量 stepper、开关行、搜索框、卡密输入、
 * 三态横幅。全部是无动画的纯 View / Pressable，触控目标 ≥44dp。
 */
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {GlassIcon} from '../../components/GlassIcon';
import {GlassIconName} from '../../components/glass-icons.generated';
import type {CouponTone} from '../../data/couponApi';
import {normalizeCouponInput} from '../../data/couponApi';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {tabularNums, type} from '../../theme/typography';

export const TONE_HEX: Record<CouponTone, string> = {
  green: '#28CD41',
  amber: '#FF9F0A',
  red: '#FF453A',
};

export const TONE_ICON: Record<CouponTone, GlassIconName> = {
  green: 'check',
  amber: 'info',
  red: 'close',
};

/* ------------------------------------------------------------------ */
/* 分段选择                                                            */
/* ------------------------------------------------------------------ */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
}) {
  const {colors, surfaces} = useAppTheme();
  return (
    <View style={[styles.segmented, {backgroundColor: surfaces.sunken}]}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{selected}}
            hitSlop={4}
            onPress={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
            style={[
              styles.segment,
              selected && {backgroundColor: surfaces.raised},
            ]}>
            <Text
              numberOfLines={1}
              style={[
                type.caption,
                styles.segmentText,
                {
                  color: selected ? colors.onSurface : colors.onSurfaceVariant,
                  fontWeight: selected ? '700' : '500',
                },
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 数量 stepper                                                        */
/* ------------------------------------------------------------------ */

export function Stepper({
  value,
  min,
  max,
  onChange,
  disabled,
  accessibilityLabel = '数量',
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const {colors, surfaces} = useAppTheme();
  const atMin = value <= min;
  const atMax = value >= max;
  const minusDisabled = disabled || atMin;
  const plusDisabled = disabled || atMax;
  const buttonStyle = [
    styles.stepperButton,
    {
      backgroundColor: surfaces.raised,
      borderColor: surfaces.highlightSoft,
    },
  ];
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`减少${accessibilityLabel}`}
        accessibilityState={{disabled: minusDisabled}}
        disabled={minusDisabled}
        hitSlop={2}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[...buttonStyle, minusDisabled && styles.dimmed]}>
        <Text style={[styles.stepperSymbol, {color: colors.onSurface}]}>−</Text>
      </Pressable>
      <Text
        accessibilityLabel={`${accessibilityLabel} ${value}`}
        style={[
          styles.stepperValue,
          tabularNums,
          {color: disabled ? colors.onSurfaceVariant : colors.onSurface},
        ]}>
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`增加${accessibilityLabel}`}
        accessibilityState={{disabled: plusDisabled}}
        disabled={plusDisabled}
        hitSlop={2}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[...buttonStyle, plusDisabled && styles.dimmed]}>
        <Text style={[styles.stepperSymbol, {color: colors.onSurface}]}>+</Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 开关行                                                              */
/* ------------------------------------------------------------------ */

export function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const {colors, surfaces} = useAppTheme();
  const on = value && !disabled;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{checked: value, disabled: !!disabled}}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={styles.toggleRow}>
      <View style={styles.toggleTextWrap}>
        <Text
          style={[
            type.body,
            {color: disabled ? colors.onSurfaceVariant : colors.onSurface},
          ]}>
          {label}
        </Text>
        {hint ? (
          <Text
            style={[
              type.caption,
              styles.toggleHint,
              {color: colors.onSurfaceVariant},
            ]}>
            {hint}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.track,
          {
            backgroundColor: on ? colors.primary : surfaces.sunken,
            borderColor: surfaces.highlightSoft,
            justifyContent: on ? 'flex-end' : 'flex-start',
          },
        ]}>
        <View
          style={[
            styles.knob,
            {backgroundColor: on ? colors.onPrimary : surfaces.raised},
          ]}
        />
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                */
/* ------------------------------------------------------------------ */

export function SearchInput({
  value,
  onChangeText,
  onSubmit,
  placeholder = '搜索卡密或备注',
  busy,
}: {
  value: string;
  onChangeText: (next: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  busy?: boolean;
}) {
  const {colors, surfaces} = useAppTheme();
  return (
    <View
      style={[
        styles.search,
        {
          backgroundColor: surfaces.raised,
          borderColor: surfaces.highlightSoft,
        },
      ]}>
      <GlassIcon name="search" size={17} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceVariant}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        accessibilityLabel={placeholder}
        style={[styles.searchInput, {color: colors.onSurface}]}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="清除搜索"
          hitSlop={11}
          onPress={() => onChangeText('')}
          style={styles.searchClear}>
          <GlassIcon name="close" size={13} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 卡密输入                                                            */
/* ------------------------------------------------------------------ */

export function CouponCodeField({
  display,
  onDisplayChange,
  onSubmitEditing,
  busy,
  invalid,
}: {
  display: string;
  onDisplayChange: (next: string) => void;
  onSubmitEditing?: () => void;
  busy?: boolean;
  invalid?: boolean;
}) {
  const {colors, surfaces} = useAppTheme();
  return (
    <TextInput
      value={display}
      onChangeText={text =>
        onDisplayChange(normalizeCouponInput(text).display)
      }
      onSubmitEditing={onSubmitEditing}
      placeholder="ABCDEFG·1234567"
      placeholderTextColor={colors.onSurfaceVariant}
      autoCapitalize="characters"
      autoCorrect={false}
      editable={!busy}
      maxLength={16}
      returnKeyType="done"
      accessibilityLabel="卡密"
      style={[
        styles.codeInput,
        tabularNums,
        {
          color: colors.onSurface,
          backgroundColor: surfaces.raised,
          borderColor: invalid ? colors.error : surfaces.highlightSoft,
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 三态横幅                                                            */
/* ------------------------------------------------------------------ */

export function StatusBanner({
  tone,
  title,
  message,
}: {
  tone: CouponTone;
  title: string;
  message?: string;
}) {
  const {colors} = useAppTheme();
  const hex = TONE_HEX[tone];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor: withAlpha(hex, 0.14),
          borderColor: withAlpha(hex, 0.42),
        },
      ]}>
      <GlassIcon name={TONE_ICON[tone]} size={18} />
      <View style={styles.bannerTextWrap}>
        <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
          {title}
        </Text>
        {message ? (
          <Text
            style={[
              type.caption,
              styles.bannerMessage,
              {color: colors.onSurfaceVariant},
            ]}>
            {message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 999,
    gap: 3,
  },
  segment: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentText: {letterSpacing: 0.2},
  stepper: {flexDirection: 'row', alignItems: 'center', gap: 10},
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperSymbol: {fontSize: 20, fontWeight: '700', lineHeight: 22},
  stepperValue: {
    minWidth: 34,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
  },
  dimmed: {opacity: 0.4},
  toggleRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleTextWrap: {flex: 1, gap: 2},
  toggleHint: {marginTop: 1},
  track: {
    width: 46,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  knob: {width: 22, height: 22, borderRadius: 11},
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  searchInput: {flex: 1, fontSize: 14, paddingVertical: 0},
  searchClear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeInput: {
    height: 58,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerTextWrap: {flex: 1, gap: 3},
  bannerMessage: {lineHeight: 17},
});
