import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {Icon} from './Icon';
import {GlassSurface} from './Surfaces';

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
  icon?: string;
  style?: ViewStyle;
  textColor?: string;
  backgroundColor?: string;
}) {
  const {colors, surfaces, isDark} = useAppTheme();
  const fg = textColor ?? colors.onPrimary;
  const bg = backgroundColor ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.flatButton,
        {
          backgroundColor: bg,
          borderTopColor: surfHighlight(surfaces.highlight, isDark),
          borderBottomColor: surfaces.shadow,
          opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
          elevation: pressed || disabled ? 0 : 3,
        },
        style,
      ]}>
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.flatButtonLabel, {color: fg}]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function surfHighlight(value: string, _isDark: boolean): string {
  return value;
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
  icon?: string;
  style?: ViewStyle;
  textColor?: string;
}) {
  const {colors, surfaces} = useAppTheme();
  const fg = textColor ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.outlinedButton,
        {
          borderTopColor: surfaces.highlight,
          borderBottomColor: surfaces.shadow,
          borderLeftColor: surfaces.highlightSoft,
          borderRightColor: surfaces.shadowSoft,
          backgroundColor: pressed ? surfaces.sunken : surfaces.raised,
          elevation: pressed ? 0 : 2,
        },
        style,
      ]}>
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
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
  size = 24,
  color,
  accessibilityLabel,
  style,
}: {
  name: string;
  onPress: () => void;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      focusable={false}
      onPress={onPress}
      hitSlop={6}
      style={({pressed}) => [
        styles.roundButton,
        {backgroundColor: pressed ? withAlpha(colors.onSurface, 0.06) : 'transparent'},
        style,
      ]}>
      <Icon name={name} size={size} color={color ?? colors.onSurface} />
    </Pressable>
  );
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
  const {colors, surfaces} = useAppTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss ?? onConfirm}>
      <View style={styles.dialogScrim}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss ?? onConfirm}
        />
        <GlassSurface
          radius={24}
          strong
          elevation={20}
          style={styles.dialogCard}>
          <Text style={[styles.dialogTitle, {color: colors.onSurface}]}>
            {title}
          </Text>
          {message ? (
            <Text style={[styles.dialogMessage, {color: colors.onSurfaceVariant}]}>
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
      </View>
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <GlassSurface
          strong
          radius={26}
          elevation={18}
          style={styles.sheetCard}>
          <View style={[styles.sheetHandle, {backgroundColor: colors.outline}]} />
          {title ? (
            <Text style={[styles.sheetTitle, {color: colors.onSurface}]}>
              {title}
            </Text>
          ) : null}
          <View style={{paddingHorizontal: tokens.sheetPadding, paddingBottom: 12}}>
            {children}
          </View>
          {footer ? <View style={{padding: tokens.sheetPadding}}>{footer}</View> : null}
        </GlassSurface>
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
  icon?: string;
  color: string;
  background: string;
}) {
  const {isDark} = useAppTheme();
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: background,
          borderTopWidth: 1,
          borderTopColor: isDark
            ? 'rgba(255,255,255,0.06)'
            : 'rgba(255,255,255,0.5)',
        },
      ]}>
      {icon ? <Icon name={icon} size={12} color={color} /> : null}
      {text ? (
        <Text style={[styles.pillText, {color}]} numberOfLines={1}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

export function Divider({color}: {color: string}) {
  return <View style={{height: StyleSheet.hairlineWidth, backgroundColor: color}} />;
}

export const styles = StyleSheet.create({
  flatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  flatButtonLabel: {fontSize: 14, fontWeight: '600'},
  outlinedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  outlinedLabel: {fontSize: 13, fontWeight: '600'},
  textButtonLabel: {fontSize: 14, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 6},
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogScrim: {
    flex: 1,
    backgroundColor: 'rgba(28,18,16,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 420,
    padding: 22,
  },
  dialogTitle: {fontSize: 19, fontWeight: '700', marginBottom: 10},
  dialogMessage: {fontSize: 14, lineHeight: 21, marginBottom: 8},
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    marginTop: 14,
  },
  sheetRoot: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(28,18,16,0.32)'},
  sheetCard: {
    width: '100%',
    paddingTop: 10,
    maxHeight: '85%',
  },
  sheetHandle: {width: 36, height: 4, borderRadius: 2, alignSelf: 'center', opacity: 0.5},
  sheetTitle: {fontSize: 17, fontWeight: '700', padding: 18, paddingBottom: 10},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    maxWidth: 110,
  },
  pillText: {fontSize: 10},
});
