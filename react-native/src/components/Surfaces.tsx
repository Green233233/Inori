import React from 'react';
import {
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';

// Bundled static textures: a soft radial glow (tinted per theme) and a subtle
// frosted-glass grain. Both are cheap single textures; no live blur shader is
// used, keeping scrolling and typing smooth on low-end devices.
const glow = require('../assets/glow.png');
const frost = require('../assets/frost.png');

/**
 * Warm ambient light behind the whole app. Gives the translucent "glass"
 * surfaces something soft to sit on, without gradient animations or blur.
 */
export function AmbientBackground() {
  const {colors, isDark} = useAppTheme();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, {backgroundColor: colors.background}]}>
      <Image
        source={glow}
        resizeMode="stretch"
        tintColor={colors.primary}
        style={{
          position: 'absolute',
          width: 680,
          height: 680,
          top: -300,
          left: -240,
          opacity: isDark ? 0.20 : 0.24,
        }}
      />
      <Image
        source={glow}
        resizeMode="stretch"
        tintColor={colors.secondaryContainer}
        style={{
          position: 'absolute',
          width: 780,
          height: 780,
          bottom: -360,
          right: -300,
          opacity: isDark ? 0.34 : 0.55,
        }}
      />
      <Image
        source={glow}
        resizeMode="stretch"
        tintColor={colors.tertiary}
        style={{
          position: 'absolute',
          width: 420,
          height: 420,
          top: '34%',
          right: -220,
          opacity: isDark ? 0.10 : 0.16,
        }}
      />
    </View>
  );
}

/**
 * Light-neumorphic raised/inset surface.
 * Borders form the two-light/two-shadow illusion (Android ignores shadow
 * colors, so elevation + edge light is the portable equivalent).
 */
export function SoftCard({
  children,
  style,
  radius = 20,
  sunken = false,
  onPress,
  onLongPress,
  disabled,
  backgroundColor,
  accessibilityLabel,
  accessibilityRole,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  sunken?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  backgroundColor?: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button';
}) {
  const {surfaces, isDark} = useAppTheme();
  const base: ViewStyle = {
    borderRadius: radius,
    backgroundColor:
      backgroundColor ?? (sunken ? surfaces.sunken : surfaces.raised),
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: sunken ? surfaces.shadowSoft : surfaces.highlight,
    borderLeftColor: sunken ? surfaces.shadowSoft : surfaces.highlightSoft,
    borderRightColor: sunken ? surfaces.highlightSoft : surfaces.shadowSoft,
    borderBottomColor: sunken ? surfaces.highlight : surfaces.shadow,
    elevation: sunken ? 0 : isDark ? 1 : 2,
    overflow: 'hidden',
  };

  const gloss = !sunken ? (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 1,
        right: 1,
        top: 1,
        height: '38%',
        borderTopLeftRadius: radius - 2,
        borderTopRightRadius: radius - 2,
        backgroundColor: isDark
          ? 'rgba(255,255,255,0.028)'
          : 'rgba(255,255,255,0.20)',
      }}
    />
  ) : null;

  if (onPress || onLongPress) {
    return (
      <Pressable
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        style={({pressed}) => [
          base,
          style,
          pressed && {
            backgroundColor: backgroundColor ?? surfaces.sunken,
            elevation: 0,
            borderTopColor: surfaces.shadowSoft,
            borderBottomColor: surfaces.highlightSoft,
          },
        ]}>
        {gloss}
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[base, style]}>
      {gloss}
      {children}
    </View>
  );
}

/**
 * Frosted-glass surface: translucent tint + grain texture + edge sheen.
 * Used for top bars, bottom bars, toolbar panels, sheets and dialogs.
 */
export function GlassSurface({
  children,
  style,
  radius = 0,
  strong = false,
  elevation = 2,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  strong?: boolean;
  elevation?: number;
}) {
  const {surfaces, isDark} = useAppTheme();
  return (
    <View
      style={[
        {
          borderRadius: radius,
          backgroundColor: strong ? surfaces.glassStrong : surfaces.glass,
          borderTopWidth: 1,
          borderLeftWidth: 1,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderTopColor: surfaces.highlight,
          borderLeftColor: surfaces.highlightSoft,
          borderRightColor: surfaces.shadowSoft,
          borderBottomColor: surfaces.shadowSoft,
          elevation,
          overflow: 'hidden',
        },
        style,
      ]}>
      <Image
        pointerEvents="none"
        source={frost}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, {opacity: isDark ? 0.32 : 0.22}]}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: '45%',
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.02)'
            : 'rgba(255,255,255,0.10)',
        }}
      />
      {children}
    </View>
  );
}
