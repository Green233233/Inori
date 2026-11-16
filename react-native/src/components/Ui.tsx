import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {onAccentFor} from '../theme/palette';
import {DURATION, EASE, USE_NATIVE_DRIVER} from '../theme/motion';
import {type} from '../theme/typography';
import {GlassIcon} from './GlassIcon';
import {GlassIconName} from './glass-icons.generated';
import {GlassSurface} from './Surfaces';
import {useReducedMotion} from '../motion/useReducedMotion';
import {usePressScale} from '../motion/usePressScale';

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export function FlatButton({
  label,
  onPress,
  disabled,
  icon,
  style,
  textColor,
  backgroundColor,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: GlassIconName;
  style?: ViewStyle;
  textColor?: string;
  backgroundColor?: string;
}) {
  const {colors} = useAppTheme();
  const press = usePressScale({pressedScale: 0.97});
  const fg = textColor ?? colors.onPrimary;
  const bg = backgroundColor ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        styles.flatButton,
        {
          backgroundColor: bg,
          opacity: disabled ? 0.45 : 1,
        },
        press.style,
        style,
      ]}>
      {icon ? (
        <GlassIcon
          name={icon}
          size={18}
          tone={onAccentFor(bg) === '#FFFFFF' ? 'light' : 'dark'}
        />
      ) : null}
      <Text style={[styles.flatButtonLabel, {color: fg}]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function OutlinedButton({
  label,
  onPress,
  icon,
  style,
  textColor,
}: {
  label: string;
  onPress: () => void;
  icon?: GlassIconName;
  style?: ViewStyle;
  textColor?: string;
}) {
  const {colors, surfaces} = useAppTheme();
  const press = usePressScale({pressedScale: 0.97});
  const fg = textColor ?? colors.onSurface;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        styles.outlinedButton,
        {
          backgroundColor: surfaces.raised,
          borderColor: surfaces.highlightSoft,
        },
        press.style,
        style,
      ]}>
      {icon ? <GlassIcon name={icon} size={18} /> : null}
      <Text style={[styles.outlinedLabel, {color: fg}]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TextButton({
  label,
  onPress,
  color,
}: {
  label: string;
  onPress: () => void;
  color?: string;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({pressed}) => ({opacity: pressed ? 0.6 : 1})}>
      <Text style={[styles.textButtonLabel, {color: color ?? colors.primary}]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function RoundIconButton({
  name,
  onPress,
  size = 22,
  accessibilityLabel,
  style,
  tone = 'auto',
}: {
  name: GlassIconName;
  onPress: () => void;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
  tone?: 'auto' | 'light' | 'dark' | 'onAccent';
}) {
  const {surfaces} = useAppTheme();
  const press = usePressScale({pressedScale: 0.92});
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      focusable={false}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={6}
      style={[
        styles.roundButton,
        {
          backgroundColor: surfaces.raised,
          borderColor: surfaces.highlightSoft,
        },
        press.style,
        style,
      ]}>
      <GlassIcon name={name} size={size} tone={tone} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Presence animation for modal surfaces                               */
/* ------------------------------------------------------------------ */

function useModalPresence(visible: boolean) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: reduced ? 0 : DURATION.base,
        easing: EASE.out,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: reduced ? 0 : DURATION.fast,
        easing: EASE.in,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start(({finished}) => {
        if (finished) {
          setMounted(false);
        }
      });
    }
    return () => progress.stopAnimation();
  }, [mounted, progress, reduced, visible]);

  return {mounted, progress, reduced};
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function AppDialog({
  visible,
  title,
  message,
  children,
  confirmLabel,
  onConfirm,
  dismissLabel,
  onDismiss,
  destructive,
}: {
  visible: boolean;
  title: string;
  message?: string;
  children?: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  dismissLabel?: string;
  onDismiss?: () => void;
  destructive?: boolean;
}) {
  const {colors} = useAppTheme();
  const {mounted, progress} = useModalPresence(visible);
  if (!mounted) {
    return null;
  }
  return (
    <Modal visible transparent animationType="none" onRequestClose={onDismiss ?? onConfirm}>
      <Animated.View style={[styles.dialogScrim, {opacity: progress}]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss ?? onConfirm}
        />
        <Animated.View
          style={{
            width: '100%',
            maxWidth: 420,
            transform: [
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
              },
            ],
          }}>
          <GlassSurface radius={24} strong elevation={20} style={styles.dialogCard}>
            <Text style={[styles.dialogTitle, {color: colors.onSurface}]}>
              {title}
            </Text>
            {message ? (
              <Text
                style={[styles.dialogMessage, {color: colors.onSurfaceVariant}]}>
                {message}
              </Text>
            ) : null}
            {children}
            <View style={styles.dialogActions}>
              {dismissLabel && onDismiss ? (
                <TextButton
                  label={dismissLabel}
                  onPress={onDismiss}
                  color={colors.onSurfaceVariant}
                />
              ) : null}
              <TextButton
                label={confirmLabel}
                onPress={onConfirm}
                color={destructive ? colors.error : colors.primary}
              />
            </View>
          </GlassSurface>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom sheet                                                        */
/* ------------------------------------------------------------------ */

export function AppSheet({
  visible,
  title,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {mounted, progress} = useModalPresence(visible);
  if (!mounted) {
    return null;
  }
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.sheetScrim, {opacity: progress}]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={{
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [28, 0],
                }),
              },
            ],
          }}>
          <GlassSurface strong radius={26} elevation={18} style={[styles.sheetCard, {paddingBottom: insets.bottom + 4}]}>
            <View style={[styles.sheetHandle, {backgroundColor: colors.outline}]} />
            {title ? (
              <Text style={[styles.sheetTitle, {color: colors.onSurface}]}>
                {title}
              </Text>
            ) : null}
            <View
              style={{paddingHorizontal: tokens.sheetPadding, paddingBottom: 12}}>
              {children}
            </View>
            {footer ? (
              <View style={{padding: tokens.sheetPadding}}>{footer}</View>
            ) : null}
          </GlassSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function Pill({
  text,
  icon,
  color,
  background,
}: {
  text?: string;
  icon?: GlassIconName;
  color: string;
  background: string;
}) {
  return (
    <View style={[styles.pill, {backgroundColor: background}]}>
      {icon ? (
        <GlassIcon
          name={icon}
          size={12}
          tone={onAccentFor(background) === '#FFFFFF' ? 'light' : 'dark'}
        />
      ) : null}
      {text ? (
        <Text style={[styles.pillText, {color}]} numberOfLines={1}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

export function Divider({color}: {color: string}) {
  return (
    <View style={{height: StyleSheet.hairlineWidth, backgroundColor: color}} />
  );
}

export const styles = StyleSheet.create({
  flatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
    height: 46,
    borderRadius: 999,
  },
  flatButtonLabel: {fontSize: 15, fontWeight: '700'},
  outlinedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  outlinedLabel: {fontSize: 14, fontWeight: '600'},
  textButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 420,
    padding: 22,
  },
  dialogTitle: {...type.headline, fontSize: 19, lineHeight: 24, marginBottom: 10},
  dialogMessage: {...type.body, fontSize: 14, lineHeight: 21, marginBottom: 8},
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    marginTop: 14,
  },
  sheetRoot: {flex: 1, justifyContent: 'flex-end'},
  sheetScrim: {backgroundColor: 'rgba(0,0,0,0.62)'},
  sheetCard: {
    width: '100%',
    paddingTop: 10,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    opacity: 0.6,
  },
  sheetTitle: {...type.section, padding: 18, paddingBottom: 10},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    maxWidth: 110,
  },
  pillText: {fontSize: 10, fontWeight: '500'},
});
