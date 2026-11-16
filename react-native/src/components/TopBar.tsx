import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';
import {GlassIcon} from './GlassIcon';

export function TopBar({
  title,
  onBack,
  right,
  titleSize,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  background?: string;
  titleSize?: number;
}) {
  const {colors, surfaces} = useAppTheme();
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            focusable={false}
            hitSlop={8}
            onPress={onBack}
            style={({pressed}) => [
              styles.back,
              {
                backgroundColor: pressed ? surfaces.sunken : surfaces.raised,
                borderColor: surfaces.highlightSoft,
              },
            ]}>
            <GlassIcon name="back" size={24} />
          </Pressable>
        ) : null}
      </View>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[
          type.section,
          {color: colors.onSurface, flex: 1, textAlign: 'left'},
          titleSize ? {fontSize: titleSize, lineHeight: titleSize + 4} : null,
        ]}>
        {title}
      </Text>
      <View style={[styles.side, styles.sideRight]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  side: {width: 44, alignItems: 'flex-start', justifyContent: 'center'},
  sideRight: {alignItems: 'flex-end'},
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
