import React from 'react';
import {Image, ImageStyle, StyleProp} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {
  GLASS_ICON_SOURCES,
  GlassIconName,
} from './glass-icons.generated';

export type GlassIconTone = 'auto' | 'light' | 'dark' | 'onAccent';

/**
 * A static PNG rendered from Nucleo Glass Icons at build time. The glass
 * material is baked in; the container/block supplies the accent color.
 */
export function GlassIcon({
  name,
  size = 24,
  tone = 'auto',
  style,
}: {
  name: GlassIconName;
  size?: number;
  tone?: GlassIconTone;
  style?: StyleProp<ImageStyle>;
}) {
  const {isDark} = useAppTheme();
  const variant =
    tone === 'light' || tone === 'onAccent'
      ? 'light'
      : tone === 'dark'
      ? 'dark'
      : isDark
      ? 'light'
      : 'dark';
  return (
    <Image
      source={GLASS_ICON_SOURCES[name][variant]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{width: size, height: size}, style]}
      resizeMode="contain"
    />
  );
}
