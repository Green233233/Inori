import React from 'react';
import {StyleProp, Text, TextStyle} from 'react-native';
import {MATERIAL_CODEPOINTS} from '../theme/material-codepoints';

interface Props {
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Material Icons rendered from the bundled icon font
 * (android/app/src/main/assets/fonts/MaterialIcons.ttf).
 */
export function Icon({name, size = 24, color = '#333333', style}: Props) {
  const glyph = MATERIAL_CODEPOINTS[name] ?? MATERIAL_CODEPOINTS.help_outline ?? '?';
  return (
    <Text
      allowFontScaling={false}
      style={[
        {
          fontFamily: 'MaterialIcons',
          fontSize: size,
          color,
          includeFontPadding: false,
          textAlignVertical: 'center',
        },
        style,
      ]}>
      {glyph}
    </Text>
  );
}

export function hasIcon(name: string): boolean {
  return MATERIAL_CODEPOINTS[name] !== undefined;
}
