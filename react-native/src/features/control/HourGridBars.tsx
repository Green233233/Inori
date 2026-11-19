/**
 * 使用时长页的「24 小时柱状图」：竖向细柱 + 右侧三条分钟参考线 + 底部时刻轴。
 *
 * 行为约束（baseline-ui / fixing-motion-performance）：
 * - 纯静态绘制，没有动画、没有渐变、没有阴影，滚动时零额外合成层。
 * - 数据只有 24 个整数（每分钟的分钟数），空数据渲染占位文字而不是空白。
 * - 高度按 `axisMax` 归一化，参考线固定在 0 / 一半 / 顶部，读数与图上一致。
 */
import React, {useMemo} from 'react';
import {Text, View} from 'react-native';

import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';

const AXIS_LABELS = ['0:00', '6:00', '12:00', '18:00', '24:00'];
const CHART_HEIGHT = 132;

export function HourGridBars({
  perHour,
  height = CHART_HEIGHT,
}: {
  perHour?: number[];
  height?: number;
}) {
  const {colors} = useAppTheme();
  const bars = useMemo(() => {
    const list = Array.isArray(perHour) ? perHour.slice(0, 24) : [];
    while (list.length < 24) {
      list.push(0);
    }
    return list.map(value => Math.max(0, Math.round(value)));
  }, [perHour]);

  const peak = Math.max(...bars);
  const hasData = peak > 0;
  // 参考线取整到 30 分钟；数据超过 60 分钟时自动抬高上限，避免柱子溢出。
  const axisMax = peak <= 60 ? 60 : Math.ceil(peak / 30) * 30;
  const midLabel = String(axisMax / 2);
  const topLabel = String(axisMax);

  return (
    <View>
      <View style={{flexDirection: 'row', alignItems: 'flex-end'}}>
        <View style={{flex: 1, height}}>
          {/* 参考线：0 / 一半 / 顶部 */}
          {[0, 0.5, 1].map(ratio => (
            <View
              key={`line-${ratio}`}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: ratio * height,
                height: 1,
                backgroundColor: colors.onSurfaceVariant,
                opacity: ratio === 1 ? 0.16 : 0.1,
              }}
            />
          ))}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              height,
              gap: 3,
            }}>
            {bars.map((minutes, hour) => {
              const ratio = axisMax === 0 ? 0 : minutes / axisMax;
              return (
                <View
                  key={`bar-${hour}`}
                  accessibilityLabel={`${hour} 点 ${minutes} 分钟`}
                  style={{flex: 1, alignItems: 'center'}}>
                  <View
                    style={{
                      width: '70%',
                      height: minutes > 0 ? Math.max(3, ratio * height) : 2,
                      borderRadius: 3,
                      backgroundColor:
                        minutes > 0 ? colors.primary : colors.surfaceVariant,
                      opacity: minutes > 0 ? 0.45 + 0.55 * ratio : 0.6,
                    }}
                  />
                </View>
              );
            })}
          </View>
        </View>
        {/* 右侧读数 */}
        <View
          style={{
            width: 42,
            height,
            justifyContent: 'space-between',
            marginLeft: 6,
          }}>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {topLabel} 分钟
          </Text>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {midLabel} 分钟
          </Text>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            0 分钟
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginLeft: 0,
          marginRight: 48,
          marginTop: 6,
        }}>
        {AXIS_LABELS.map(label => (
          <Text
            key={label}
            style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {label}
          </Text>
        ))}
      </View>

      {!hasData ? (
        <Text
          style={[
            type.caption,
            {color: colors.onSurfaceVariant, marginTop: 8},
          ]}>
          这一天还没有屏幕使用记录。
        </Text>
      ) : null}
    </View>
  );
}
