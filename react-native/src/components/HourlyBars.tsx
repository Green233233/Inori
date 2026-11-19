/**
 * 24 根细柱展示「今天每小时的屏幕时间」。
 *
 * 不引入图表库：一根柱子就是一小时的分钟数，高度按当天峰值归一化。
 */
import React from 'react';
import {Text, View} from 'react-native';

import {useAppTheme} from '../theme/AppThemeProvider';
import {type} from '../theme/typography';

export function HourlyBars({
  hours,
}: {
  hours?: {hour: number; minutes: number}[];
}) {
  const {colors} = useAppTheme();
  const list = hours && hours.length === 24 ? hours : [];
  if (list.length === 0) {
    return null;
  }
  const peak = Math.max(1, ...list.map(item => item.minutes));
  const busiest = list.reduce(
    (best, item) => (item.minutes > best.minutes ? item : best),
    list[0],
  );
  return (
    <View style={{marginTop: 12, marginBottom: 4}}>
      <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
        分时分布 · 最忙是 {busiest.hour} 点（{busiest.minutes} 分钟）
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          height: 78,
          marginTop: 8,
          gap: 2,
        }}>
        {list.map(item => (
          <View key={item.hour} style={{flex: 1, alignItems: 'center'}}>
            <View
              style={{
                width: '100%',
                height: Math.max(2, (item.minutes / peak) * 64),
                borderRadius: 3,
                backgroundColor:
                  item.minutes > 0 ? colors.primary : colors.surfaceVariant,
                opacity:
                  item.minutes > 0 ? 0.35 + 0.65 * (item.minutes / peak) : 0.5,
              }}
            />
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 2,
        }}>
        {[0, 6, 12, 18, 23].map(hour => (
          <Text
            key={hour}
            style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {hour}
          </Text>
        ))}
      </View>
    </View>
  );
}
