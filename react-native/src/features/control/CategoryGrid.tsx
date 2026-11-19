/**
 * 使用时长页的「按类别」四宫格：2×2，每格一个分类色 + 分类名 + 分钟数。
 *
 * 分类色只用于数据可视化（不是操作色），因此这里用一组固定的、在浅色/深色
 * 主题下都够对比的色相；具体数值由调用方决定顺序与文案。
 */
import React from 'react';
import {Text, View} from 'react-native';

import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';

const CATEGORY_COLORS: Record<string, string> = {
  social: '#2F6FED',
  media: '#8B5CF6',
  music: '#E0457B',
  game: '#16A34A',
  tools: '#64748B',
  uncategorized: '#F59E0B',
};

export type CategorySlice = {
  key: string;
  label: string;
  minutes: number;
};

export function CategoryGrid({categories}: {categories: CategorySlice[]}) {
  const {colors} = useAppTheme();
  const rows: CategorySlice[][] = [];
  for (let i = 0; i < categories.length; i += 2) {
    rows.push(categories.slice(i, i + 2));
  }

  return (
    <View style={{gap: 14}}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={{flexDirection: 'row'}}>
          {[0, 1].map(column => {
            const item = row[column];
            if (!item) {
              return <View key={`gap-${column}`} style={{flex: 1}} />;
            }
            const tint = CATEGORY_COLORS[item.key] ?? colors.secondary;
            return (
              <View
                key={item.key}
                style={{flex: 1}}
                accessibilityLabel={`${item.label} ${formatMinutes(item.minutes)}`}>
                <Text style={[type.headline, {color: tint}]}>
                  {item.label}
                </Text>
                <Text
                  style={[type.section, {color: colors.onSurface, marginTop: 2}]}>
                  {formatMinutes(item.minutes)}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function formatMinutes(minutes: number): string {
  const value = Math.max(0, Math.round(minutes ?? 0));
  if (value <= 0) {
    return '小于 1 分钟';
  }
  if (value < 60) {
    return `${value} 分钟`;
  }
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}
