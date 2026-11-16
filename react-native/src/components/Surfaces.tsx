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
import {withAlpha} from '../theme/palette';
import {usePressScale} from '../motion/usePressScale';

const glow = require('../assets/glow.png');
const frost = require('../assets/frost.png');

/**
 * Near-black canvas with three saturated color fields. Static textures only:
 * no live blur, no animated gradients, cheap to keep on screen.
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
          width: 760,
          height: 760,
          top: -340,
          left: -280,
          opacity: isDark ? 0.24 : 0.035,
        }}
      />
      <Image
        source={glow}
        resizeMode="stretch"
        tintColor={colors.secondary}
        style={{
          position: 'absolute',
          width: 720,
          height: 720,
          top: '22%',
          right: -320,
          opacity: isDark ? 0.18 : 0.025,
        }}
      />
      <Image
        source={glow}
        resizeMode="stretch"
        tintColor={colors.tertiary}
        style={{
          position: 'absolute',
          width: 560,
          height: 560,
          bottom: -260,
          left: -180,
          opacity: isDark ? 0.10 : 0.02,
        }}
      />
    </View>
  );
}

/**
 * Flat editorial card with a hint of glass. No neumorphic double border; the
 * Apple-music direction relies on color, spacing and a 1px separator.
 */
export function SoftCard({
  children,
  style,
  radius = 14,
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
  const {surfaces} = useAppTheme();
  const press = usePressScale({pressedScale: 0.975});
  const base: ViewStyle = {
    borderRadius: radius,
    backgroundColor: backgroundColor ?? (sunken ? surfaces.sunken : surfaces.raised),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sunken ? surfaces.shadowSoft : surfaces.highlightSoft,
    elevation: 0,
  };
  if (onPress || onLongPress) {
    return (
      <Pressable
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({pressed}) => [
          base,
          {backgroundColor: pressed ? surfaces.sunken : base.backgroundColor},
          press.style,
          style,
        ]}>
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[base, style]}>
      {children}
    </View>
  );
}

/**
 * Frosted chrome / sheet surface. The frost texture is static; the translucent
 * fill stands in for Apple's backdrop blur without per-frame offscreen work.
 */
export function GlassSurface({
  children,
  style,
  radius = 0,
  strong = false,
  elevation = 0,
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
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isDark
            ? 'rgba(255,255,255,0.14)'
            : 'rgba(255,255,255,0.9)',
          elevation,
          overflow: 'hidden',
        },
        style,
      ]}>
      <Image
        pointerEvents="none"
        source={frost}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, {opacity: isDark ? 0.26 : 0.18}]}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: '42%',
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.025)'
            : 'rgba(255,255,255,0.22)',
        }}
      />
      {children}
    </View>
  );
}

/**
 * Apple Music-like editorial color field: a solid saturated surface with two
 * translucent discs for depth. Deliberately no linear gradient.
 */
export function ColorField({
  color,
  children,
  style,
  radius = 20,
}: {
  color: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
}) {
  return (
    <View
      style={[
        {backgroundColor: color, borderRadius: radius, overflow: 'hidden'},
        style,
      ]}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: 260,
          height: 260,
          borderRadius: 130,
          right: -90,
          top: -120,
          backgroundColor: 'rgba(255,255,255,0.16)',
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: 180,
          height: 180,
          borderRadius: 90,
          right: 20,
          bottom: -100,
          backgroundColor: 'rgba(0,0,0,0.10)',
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: '40%',
          backgroundColor: 'rgba(255,255,255,0.06)',
        }}
      />
      {children}
    </View>
  );
}

export function separatorColor(color: string, isDark: boolean): string {
  return withAlpha(color, isDark ? 0.18 : 0.10);
}
