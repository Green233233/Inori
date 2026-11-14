import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Icon} from './Icon';
import {GlassSurface} from './Surfaces';
import {useAppTheme} from '../theme/AppThemeProvider';

export function TopBar({
  title,
  onBack,
  right,
  titleSize = 19,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  background?: string;
  titleSize?: number;
}) {
  const {colors, surfaces} = useAppTheme();
  return (
    <GlassSurface
      radius={0}
      elevation={0}
      style={{
        borderTopWidth: 0,
        borderLeftWidth: 0,
        borderRightWidth: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: surfaces.shadowSoft,
      }}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {onBack ? (
            <PressableIcon name="arrow_back" onPress={onBack} label="返回" />
          ) : null}
        </View>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.title, {color: colors.onSurface, fontSize: titleSize}]}>
          {title}
        </Text>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </GlassSurface>
  );
}

function PressableIcon({
  name,
  onPress,
  label,
}: {
  name: string;
  onPress: () => void;
  label: string;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      focusable={false}
      hitSlop={8}
      onPress={onPress}
      style={styles.iconButton}>
      <Icon name={name} size={24} color={colors.onSurface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  side: {width: 48, alignItems: 'flex-start', justifyContent: 'center'},
  sideRight: {alignItems: 'flex-end'},
  title: {flex: 1, textAlign: 'center', fontWeight: '700'},
  iconButton: {paddingHorizontal: 10, paddingVertical: 8},
});
