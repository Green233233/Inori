/**
 * 主人端的「屏幕使用时长」详情页。
 *
 * 版式对齐系统「数字健康」的详情页：每天/每周切换、日期前后翻、当日总时长与环比、
 * 24 小时柱（0/中/上限三条参考线 + 0:00–24:00 时刻轴）、按分类的四宫格，最后是
 * 应用明细列表。
 *
 * 数据全部通过端到端加密命令现取（`usage.day` / `usage.range`），服务器不留明文；
 * 小狗端离线、未授权或关闭共享时如实提示，并保留「显示今天」作为恢复入口。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {SoftCard} from '../../components/Surfaces';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import type {
  UsageAppEntry,
  UsageCategory,
  UsageCategoryKey,
  UsageDaySummary,
  UsageRangeStats,
} from '../../native/QiDevice';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {useQi} from '../qi/QiProvider';

import {CategoryGrid, formatMinutes} from './CategoryGrid';
import {HourGridBars} from './HourGridBars';

type Mode = 'day' | 'week';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

function formatDate(dayStartMs: number): string {
  const date = new Date(dayStartMs);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}/${month}/${day} ${WEEKDAYS[date.getDay()]}`;
}

export function UsageStatsScreen({onBack}: {onBack: () => void}) {
  const {colors, tokens, surfaces} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, runCommand, refreshPair} = useQi();
  const [mode, setMode] = useState<Mode>('day');
  const [dayStartMs, setDayStartMs] = useState(() => startOfDay(Date.now()));
  const [day, setDay] = useState<UsageDaySummary | null>(null);
  const [prevDay, setPrevDay] = useState<UsageDaySummary | null>(null);
  const [week, setWeek] = useState<UsageRangeStats | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const partner = pair?.puppyName ?? '小狗';

  const load = useCallback(
    async (silent = false) => {
      setBusy(true);
      try {
        // v0.6.8：三条命令以前用 Promise.all，只要其中一条（比如 7 天汇总
        // 在小狗端算得慢一点）没回包，整页就只剩「对方没有响应」——明明当天
        // 的数据已经拿到了。改成 allSettled：能显示多少显示多少，只有三条全
        // 失败才报错。
        const [dayResult, prevResult, weekResult] = await Promise.allSettled([
          runCommand('usage.day', {dayStartMs}),
          runCommand('usage.day', {dayStartMs: dayStartMs - DAY_MS}),
          runCommand('usage.range', {days: 7}),
        ]);
        refreshPair().catch(() => undefined);
        const dayReply = dayResult.status === 'fulfilled' ? dayResult.value : null;
        const prevReply = prevResult.status === 'fulfilled' ? prevResult.value : null;
        const weekReply = weekResult.status === 'fulfilled' ? weekResult.value : null;

        if (!dayReply?.ok) {
          setDay(null);
          setPrevDay(null);
          setWeek(null);
          const allFailed = !prevReply?.ok && !weekReply?.ok;
          const firstError =
            (dayReply && !dayReply.ok && dayReply.error) ||
            (dayResult.status === 'rejected' && (dayResult.reason as any)?.message);
          setHint(
            allFailed || !firstError
              ? firstError || '小狗端没有返回数据'
              : firstError,
          );
          return;
        }
        setDay(dayReply.data as UsageDaySummary);
        setPrevDay(prevReply?.ok ? (prevReply.data as UsageDaySummary) : null);
        setWeek(weekReply?.ok ? (weekReply.data as UsageRangeStats) : null);
        setHint(null);
      } catch (error: any) {
        setDay(null);
        setPrevDay(null);
        setWeek(null);
        setHint(error?.message ?? '请求失败');
        if (!silent) {
          showToast('没拿到使用时长');
        }
      } finally {
        setBusy(false);
      }
    },
    [dayStartMs, refreshPair, runCommand],
  );

  useEffect(() => {
    load(true).catch(() => undefined);
  }, [load]);

  const today = startOfDay(Date.now());
  const showingToday = isSameDay(dayStartMs, today);

  /** 每周视图：把 7 天按分类/应用合并，柱状图仍用小时分布。 */
  const weekView = useMemo(() => {
    if (!week) {
      return null;
    }
    const categoryMap = new Map<UsageCategoryKey, UsageCategory>();
    const appMap = new Map<string, UsageAppEntry>();
    const perHour = new Array(24).fill(0) as number[];
    let totalMinutes = 0;
    for (const item of week.days) {
      totalMinutes += item.totalMinutes ?? 0;
      item.perHour?.forEach((minutes, hour) => {
        perHour[hour] += minutes ?? 0;
      });
      for (const category of item.byCategory ?? []) {
        const current = categoryMap.get(category.key);
        categoryMap.set(category.key, {
          key: category.key,
          label: category.label,
          minutes: (current?.minutes ?? 0) + category.minutes,
        });
      }
      for (const app of item.apps ?? []) {
        const current = appMap.get(app.pkg);
        appMap.set(app.pkg, {
          pkg: app.pkg,
          label: app.label,
          minutes: (current?.minutes ?? 0) + app.minutes,
          sessions: (current?.sessions ?? 0) + app.sessions,
          icon: current?.icon ?? app.icon,
        });
      }
    }
    return {
      totalMinutes,
      perHour,
      byCategory: [...categoryMap.values()].sort((a, b) => b.minutes - a.minutes),
      apps: [...appMap.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 12),
      days: week.days,
    };
  }, [week]);

  const activeDay = dayStartMs;
  const totalMinutes = mode === 'day' ? day?.totalMinutes ?? 0 : weekView?.totalMinutes ?? 0;
  const perHour = mode === 'day' ? day?.perHour ?? [] : weekView?.perHour ?? [];
  const categories = mode === 'day' ? day?.byCategory ?? [] : weekView?.byCategory ?? [];
  const apps = mode === 'day' ? day?.apps ?? [] : weekView?.apps ?? [];

  const delta = useMemo(() => {
    if (mode !== 'day' || !day || !prevDay) {
      return null;
    }
    return Math.round((day.totalMinutes ?? 0) - (prevDay.totalMinutes ?? 0));
  }, [day, mode, prevDay]);

  const shiftDay = (offset: number) => {
    const next = startOfDay(dayStartMs + offset * DAY_MS);
    if (next > startOfDay(Date.now())) {
      return;
    }
    setDayStartMs(next);
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <TopBar title="屏幕使用时长" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => load().catch(() => undefined)}
            tintColor={colors.primary}
          />
        }>
        <View style={[styles.segmented, {backgroundColor: surfaces.sunken}]}>
          {(['day', 'week'] as Mode[]).map(option => {
            const selected = option === mode;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={option === 'day' ? '每天' : '每周'}
                accessibilityState={{selected}}
                onPress={() => setMode(option)}
                style={[
                  styles.segment,
                  selected && {backgroundColor: surfaces.raised},
                ]}>
                <Text
                  style={[
                    type.bodyStrong,
                    {
                      color: selected ? colors.onSurface : colors.onSurfaceVariant,
                    },
                  ]}>
                  {option === 'day' ? '每天' : '每周'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SoftCard style={{marginTop: 12}}>
          <View style={styles.headerRow}>
            {mode === 'day' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="前一天"
                hitSlop={8}
                onPress={() => shiftDay(-1)}
                style={styles.arrow}>
                <Text style={[type.section, {color: colors.onSurfaceVariant}]}>
                  ‹
                </Text>
              </Pressable>
            ) : null}
            <Text
              style={[type.bodyStrong, {color: colors.onSurfaceVariant, flex: 1}]}>
              {mode === 'day' ? formatDate(activeDay) : '最近 7 天'}
            </Text>
            {mode === 'day' && !showingToday ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="后一天"
                hitSlop={8}
                onPress={() => shiftDay(1)}
                style={styles.arrow}>
                <Text style={[type.section, {color: colors.onSurfaceVariant}]}>
                  ›
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="显示今天"
              disabled={mode === 'day' && showingToday}
              onPress={() => setDayStartMs(today)}
              style={[
                styles.todayPill,
                {
                  backgroundColor:
                    mode === 'day' && showingToday
                      ? surfaces.sunken
                      : colors.primary,
                },
              ]}>
              <Text
                style={[
                  type.caption,
                  {
                    color:
                      mode === 'day' && showingToday
                        ? colors.onSurfaceVariant
                        : colors.onPrimary,
                    fontWeight: '700',
                  },
                ]}>
                显示今天
              </Text>
            </Pressable>
          </View>

          <Text
            style={[
              type.display,
              {color: colors.onSurface, marginTop: 10, fontVariant: ['tabular-nums']},
            ]}>
            {formatMinutes(totalMinutes)}
          </Text>
          {mode === 'day' && delta !== null ? (
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 2},
              ]}>
              {delta === 0
                ? '和前一天一样'
                : `比前一天${delta > 0 ? '增加' : '减少'} ${formatMinutes(
                    Math.abs(delta),
                  )}`}
            </Text>
          ) : null}
          {mode === 'week' && weekView ? (
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 2},
              ]}>
              平均每天 {formatMinutes(Math.round(weekView.totalMinutes / 7))}
            </Text>
          ) : null}

          <View style={{marginTop: 14}}>
            <HourGridBars perHour={perHour} />
          </View>

          <View style={{marginTop: 18}}>
            <CategoryGrid categories={categories} />
          </View>
        </SoftCard>

        {hint ? (
          <SoftCard style={{marginTop: 12}}>
            <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
              {hint}
            </Text>
            {hint.includes('使用时长') ? (
              <Text
                style={[
                  type.caption,
                  {color: colors.onSurfaceVariant, marginTop: 6},
                ]}>
                让{partner}在「我的 → 响应配置」里打开「使用时长」共享。
              </Text>
            ) : null}
          </SoftCard>
        ) : null}

        <View style={styles.sectionRow}>
          <Text style={[type.section, {color: colors.onSurface}]}>统计详情</Text>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            应用 ⌄
          </Text>
        </View>

        <SoftCard>
          {apps.length === 0 ? (
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              还没有数据。{partner}开启「使用情况访问」后这里会显示应用明细。
            </Text>
          ) : (
            apps.map((item, index) => (
              <View
                key={item.pkg}
                accessibilityLabel={`${item.label} ${formatMinutes(item.minutes)}`}
                style={[
                  styles.appRow,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.outline,
                  },
                ]}>
                {item.icon ? (
                  <Image
                    source={{uri: item.icon}}
                    style={styles.appIcon}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View
                    style={[
                      styles.appIcon,
                      styles.appIconFallback,
                      {backgroundColor: colors.surfaceVariant},
                    ]}
                  />
                )}
                <View style={{flex: 1}}>
                  <Text
                    style={[type.body, {color: colors.onSurface}]}
                    numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text
                    style={[
                      type.caption,
                      {
                        color: colors.onSurfaceVariant,
                        marginTop: 2,
                        fontVariant: ['tabular-nums'],
                      },
                    ]}>
                    {formatMinutes(item.minutes)}
                  </Text>
                </View>
                <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
                  ›
                </Text>
              </View>
            ))
          )}
        </SoftCard>

        <Text
          style={[
            type.caption,
            {color: colors.onSurfaceVariant, marginTop: 14},
          ]}>
          数据来自{partner}的「使用情况访问」，每次只在你要看的时候读一次。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  segmented: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 4,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 999,
  },
  headerRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  arrow: {paddingHorizontal: 4, paddingVertical: 2},
  todayPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  appIcon: {width: 28, height: 28, borderRadius: 8},
  appIconFallback: {},
});
