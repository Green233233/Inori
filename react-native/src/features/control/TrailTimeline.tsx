/**
 * 「小狗轨迹」时间轴的纯展示层。
 *
 * 每行左边是一条固定 44 宽的轨道：先一个 24 的圆形标记，再接一段 2px 竖线，
 * 把相邻事件串成同一根轴；右边一张 SoftCard 放事件本身。这里不含任何取数、
 * 排序或分组逻辑——那些都在 Trail.tsx 里算好再传进来，方便单独复用与回看。
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {SoftCard} from '../../components/Surfaces';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';

export type TrailEventKind = 'usage' | 'place' | 'move';

export type TrailEvent = {
  /** React key，同时作为同一时刻事件的稳定兜底排序。 */
  key: string;
  kind: TrailEventKind;
  /** 事件开始时间，时间轴按它倒序。 */
  at: number;
  /** 主文案：应用名、地址，或 `出行 0.5KM`。 */
  title: string;
  /** 时间片段：`16:13–16:14` / `16:10` / `进行中`。 */
  time: string;
  /** 时间之后的补充说明，例如 `1 分钟`、`均速 1.8km/h · 最高 5.5km/h`。 */
  detail?: string;
};

const KIND_LABEL: Record<TrailEventKind, string> = {
  usage: '使用手机',
  place: '位置',
  move: '出行',
};

export function TrailTimeline({events}: {events: TrailEvent[]}) {
  return (
    <View>
      {events.map((event, index) => (
        <TrailRow
          key={event.key}
          event={event}
          last={index === events.length - 1}
        />
      ))}
    </View>
  );
}

function TrailRow({event, last}: {event: TrailEvent; last: boolean}) {
  const {colors} = useAppTheme();
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View
          style={[styles.marker, {backgroundColor: colors.primaryContainer}]}>
          <View
            style={[
              styles.markerCore,
              {backgroundColor: colors.onPrimaryContainer},
            ]}
          />
        </View>
        <View
          style={[
            styles.railLine,
            {backgroundColor: colors.outline},
            last ? styles.railLineLast : null,
          ]}
        />
      </View>
      <View
        accessible
        accessibilityLabel={`${KIND_LABEL[event.kind]} ${event.title} ${event.time}`}
        style={styles.cardWrap}>
        <SoftCard style={styles.card}>
          <Text
            style={[type.bodyStrong, {color: colors.onSurface}]}
            numberOfLines={1}
            ellipsizeMode="tail">
            {event.title}
          </Text>
          <Text
            style={[
              type.caption,
              styles.detail,
              {color: colors.onSurfaceVariant, fontVariant: ['tabular-nums']},
            ]}
            numberOfLines={2}>
            {event.detail ? `${event.time} · ${event.detail}` : event.time}
          </Text>
        </SoftCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row'},
  rail: {width: 44, alignItems: 'center', paddingTop: 2},
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerCore: {width: 8, height: 8, borderRadius: 4},
  railLine: {width: 2, flex: 1, minHeight: 10, marginTop: 4, borderRadius: 1},
  railLineLast: {opacity: 0},
  cardWrap: {flex: 1, paddingBottom: 12},
  card: {paddingHorizontal: 14, paddingVertical: 12},
  detail: {marginTop: 3},
});
