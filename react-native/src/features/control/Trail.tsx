/**
 * 主人端「小狗轨迹」。
 *
 * 一根按时间倒序的时间轴，把三类事件混在同一根轴上（视觉参照系统「数字健康」
 * 的时间轴，但沿用本应用的 SoftCard / 主题令牌）：
 *  - 使用手机：先读服务器暂存拉到本机的 `usage.sessions`，过期才直连现取；
 *  - 位置采样：`trailStore` 留在本机的采样点，两次移动之间的点并成一段停留；
 *  - 出行：相邻采样点位移超过 500 米算一次移动，带距离与速度。
 *
 * 数据只留在本机与端到端加密的通道里；页面不后台定位、不定时轮询，只有点
 * 「取一次位置」时才请小狗端现取一次最后已知位置并补一笔采样。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {SoftCard} from '../../components/Surfaces';
import {TopBar} from '../../components/TopBar';
import {FlatButton} from '../../components/Ui';
import {showToast} from '../../components/toast';
import {
  loadTrail,
  recordTrailPoint,
  trailMoves,
  type TrailMove,
  type TrailPoint,
} from '../../data/trailStore';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {useQi} from '../qi/QiProvider';
import {readState, writeState} from '../../sync/stateCache';

import {
  TrailTimeline,
  type TrailEvent,
  type TrailEventKind,
} from './TrailTimeline';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 时间轴一次最多渲染最近多少段使用，避免一整天几千条会话卡住主线程。 */
const SESSION_LIMIT = 300;

/** 原生 `usage.sessions` 回来的单段会话，字段与 QiDevice.UsageSession 一致。 */
type UsageSession = {
  pkg: string;
  label: string;
  startMs: number;
  endMs: number;
  minutes: number;
  open: boolean;
};

/** 只用到 ok/data/error 三个字段，本页不关心回执 id。 */
type SessionsReply = {ok: boolean; data?: unknown; error?: string};

/** 同一起始时间时的先后：出行 > 位置 > 使用。 */
const KIND_RANK: Record<TrailEventKind, number> = {
  move: 0,
  place: 1,
  usage: 2,
};

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate(),
  )} ${WEEKDAYS[date.getDay()]}`;
}

function formatMinutesText(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) {
    return '小于 1 分钟';
  }
  return `${Math.round(minutes)} 分钟`;
}

function formatPlace(point: TrailPoint): string {
  const address = (point.address ?? '').trim();
  if (address) {
    return address;
  }
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

function formatSpeedKmh(
  distanceM: number,
  fromAt: number,
  toAt: number,
): string {
  const hours = (toAt - fromAt) / 3_600_000;
  if (!(hours > 0)) {
    return '';
  }
  return (distanceM / 1000 / hours).toFixed(1);
}

/**
 * 把三类数据拼成一根倒序时间轴。
 *
 * 位置按「移动」切成停留段：相邻两个采样点只要没构成移动（位移 < 500 米），
 * 就当作还待在原地，合并成一张卡；一段里有两个以上采样点时副行给区间，
 * 只剩一个点时它只是当次采样，只给时刻。
 */
function buildTimeline(
  sessions: UsageSession[],
  points: TrailPoint[],
  moves: TrailMove[],
): TrailEvent[] {
  const events: TrailEvent[] = [];

  for (const session of sessions) {
    events.push({
      key: `usage-${session.startMs}-${session.pkg}`,
      kind: 'usage',
      at: session.startMs,
      title: session.label,
      time: `${formatTime(session.startMs)}–${
        session.open ? '进行中' : formatTime(session.endMs)
      }`,
      detail: formatMinutesText(session.minutes),
    });
  }

  const departures = new Set(moves.map(move => move.from.at));
  const stays: TrailPoint[][] = [];
  for (const point of points) {
    const current = stays[stays.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || (previous && departures.has(previous.at))) {
      stays.push([point]);
    } else {
      current.push(point);
    }
  }
  for (const stay of stays) {
    const first = stay[0];
    const last = stay[stay.length - 1];
    // 同一段停留里只要有一个点带地址就用它，否则退回经纬度。
    const titled = stay.find(point => (point.address ?? '').trim()) ?? first;
    events.push({
      key: `place-${first.at}`,
      kind: 'place',
      at: first.at,
      title: formatPlace(titled),
      time:
        last.at > first.at
          ? `${formatTime(first.at)}–${formatTime(last.at)}`
          : formatTime(first.at),
    });
  }

  for (const move of moves) {
    const km = move.distanceM / 1000;
    const speed = formatSpeedKmh(move.distanceM, move.from.at, move.to.at);
    events.push({
      key: `move-${move.from.at}-${move.to.at}`,
      kind: 'move',
      at: move.from.at,
      title: `出行 ${km.toFixed(1)}KM`,
      time: `${formatTime(move.from.at)}–${formatTime(move.to.at)}`,
      // 一次移动只有两个端点，能算的只有平均速度，所以「最高」按同一段算。
      detail: speed ? `均速 ${speed}km/h · 最高 ${speed}km/h` : undefined,
    });
  }

  return events.sort(
    (a, b) =>
      b.at - a.at ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.key.localeCompare(b.key),
  );
}

export function Trail({onBack}: {onBack: () => void}) {
  const {colors, surfaces, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, runCommand, refreshPair} = useQi();
  const partner = pair?.puppyName ?? '小狗';

  const [dayStartMs, setDayStartMs] = useState(() => startOfDay(Date.now()));
  const [sessions, setSessions] = useState<UsageSession[]>([]);
  const [points, setPoints] = useState<TrailPoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayMs = startOfDay(Date.now());
  const showingToday = dayStartMs === todayMs;

  const load = useCallback(
    async (silent = false) => {
      setBusy(true);
      setError(null);
      setLoaded(false);
      // 换日期时先把上一天的内容清掉，避免新日期下面短暂挂着旧事件。
      setSessions([]);
      setPoints([]);
      const dayEndMs = dayStartMs + DAY_MS;
      // 只看今天时，优先用小狗端定时上报、经服务器暂存拉到本机的会话。
      const cachedTrail = showingToday
        ? await readState<{sessions?: UsageSession[]}>('trail').catch(() => null)
        : null;
      const freshTrail =
        cachedTrail?.data && Date.now() - cachedTrail.at <= 30 * 60_000
          ? cachedTrail
          : null;
      // 两路各自起请求：本机轨迹不依赖小狗端，离线时也要能翻看过往记录。
      const trailTask = loadTrail().catch((): TrailPoint[] => []);
      const replyTask = freshTrail
        ? null
        : runCommand('usage.sessions', {
            fromMs: dayStartMs,
            toMs: dayEndMs,
          }).catch(
            (err: unknown): SessionsReply => ({
              ok: false,
              error: err instanceof Error ? err.message : '取使用记录失败',
            }),
          );
      try {
        const trail = await trailTask;
        setPoints(
          trail.filter(point => point.at >= dayStartMs && point.at < dayEndMs),
        );

        const reply: SessionsReply = freshTrail
          ? ({ok: true, data: freshTrail.data} as SessionsReply)
          : await replyTask!;
        if (freshTrail) {
          setError(null);
        }
        if (!reply.ok) {
          setSessions([]);
          setError(reply.error ?? '小狗端没有返回使用记录');
          if (!silent) {
            showToast(reply.error ?? '小狗端没有返回使用记录');
          }
          return;
        }
        const payload = (reply.data ?? {}) as {sessions?: UsageSession[]};
        const list = Array.isArray(payload.sessions) ? payload.sessions : [];
        if (!freshTrail) {
          writeState('trail', reply.data ?? {}, 'direct').catch(() => undefined);
        }
        setSessions(
          list.filter(
            session =>
              session.startMs >= dayStartMs && session.startMs < dayEndMs,
          ),
        );
        refreshPair().catch(() => undefined);
      } catch (err) {
        const message = err instanceof Error ? err.message : '读取轨迹失败';
        setError(message);
        if (!silent) {
          showToast(message);
        }
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [dayStartMs, refreshPair, runCommand],
  );

  useEffect(() => {
    load(true).catch(() => undefined);
  }, [load]);

  const shiftDay = useCallback(
    (offset: number) => {
      const next = startOfDay(dayStartMs + offset * DAY_MS);
      if (next > todayMs) {
        return;
      }
      setDayStartMs(next);
    },
    [dayStartMs, todayMs],
  );

  /** 向小狗端现取一次位置，拿到坐标就补一笔采样，让时间轴立刻多一条。 */
  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const reply = await runCommand('location.get');
      const data = (reply.data ?? {}) as {
        lat?: number;
        lng?: number;
        address?: string;
      };
      const lat = Number(data.lat);
      const lng = Number(data.lng);
      if (!reply.ok || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        showToast(reply.error ?? '小狗端暂时没有可用的位置');
        return;
      }
      const address =
        (data.address ?? '').trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const at = Date.now();
      await recordTrailPoint({at, lat, lng, address}).catch(() => undefined);
      if (!isSameDay(at, dayStartMs)) {
        // 取回来的是今天的点，先跳到今天；effect 会连使用记录一起重取。
        setDayStartMs(startOfDay(at));
      } else {
        await load();
      }
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : `取位置失败，${partner}可能不在线`,
      );
    } finally {
      setLocating(false);
    }
  }, [dayStartMs, load, partner, runCommand]);

  const visibleSessions = useMemo(
    () => sessions.slice(-SESSION_LIMIT),
    [sessions],
  );
  const moves = useMemo(() => trailMoves(points), [points]);
  const events = useMemo(
    () => buildTimeline(visibleSessions, points, moves),
    [visibleSessions, points, moves],
  );
  const summary = useMemo(() => {
    const screenMinutes = sessions.reduce(
      (total, session) =>
        total + (Number.isFinite(session.minutes) ? session.minutes : 0),
      0,
    );
    return `共 ${sessions.length} 段使用 · ${moves.length} 次移动 · ${Math.round(
      screenMinutes,
    )} 分钟屏幕时间`;
  }, [moves.length, sessions]);

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <TopBar title="小狗轨迹" onBack={onBack} />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          {
            paddingHorizontal: tokens.contentPadding,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          数据只留在本机，用来回看今天去过哪里、用了多久手机。
        </Text>

        <SoftCard style={styles.dateCard}>
          <View style={styles.dateRow}>
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
            <Text
              style={[type.bodyStrong, styles.dateText, {color: colors.onSurface}]}
              numberOfLines={1}>
              {formatDate(dayStartMs)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="后一天"
              accessibilityState={{disabled: showingToday}}
              disabled={showingToday}
              hitSlop={8}
              onPress={() => shiftDay(1)}
              style={styles.arrow}>
              <Text
                style={[
                  type.section,
                  {color: colors.onSurfaceVariant},
                  showingToday ? styles.arrowDisabled : null,
                ]}>
                ›
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="显示今天"
              disabled={showingToday}
              onPress={() => setDayStartMs(todayMs)}
              style={[
                styles.todayPill,
                {
                  backgroundColor: showingToday
                    ? surfaces.sunken
                    : colors.primary,
                },
              ]}>
              <Text
                style={[
                  type.caption,
                  styles.pillLabel,
                  {
                    color: showingToday
                      ? colors.onSurfaceVariant
                      : colors.onPrimary,
                  },
                ]}>
                显示今天
              </Text>
            </Pressable>
          </View>
        </SoftCard>

        {error ? (
          <SoftCard style={styles.block}>
            <Text style={[type.body, {color: colors.onSurface}]}>读取失败</Text>
            <Text
              style={[
                type.caption,
                styles.blockHint,
                {color: colors.onSurfaceVariant},
              ]}>
              {error}
            </Text>
          </SoftCard>
        ) : null}

        {busy && !loaded ? (
          <Text style={[type.caption, styles.summary, {color: colors.onSurfaceVariant}]}>
            正在读取…
          </Text>
        ) : null}

        {loaded && events.length > 0 ? (
          <Text
            style={[
              type.caption,
              styles.summary,
              {color: colors.onSurfaceVariant},
            ]}>
            {summary}
          </Text>
        ) : null}

        {events.length > 0 ? <TrailTimeline events={events} /> : null}

        {loaded && !error && events.length === 0 ? (
          <SoftCard style={styles.block}>
            <Text style={[type.body, {color: colors.onSurface}]}>
              今天还没有记录。
            </Text>
            <Text
              style={[
                type.caption,
                styles.blockHint,
                {color: colors.onSurfaceVariant},
              ]}>
              点下面的按钮向小狗端取一次位置，之后就会留下记录。
            </Text>
          </SoftCard>
        ) : null}

        {loaded && sessions.length > SESSION_LIMIT ? (
          <Text
            style={[
              type.caption,
              styles.summary,
              {color: colors.onSurfaceVariant},
            ]}>
            只显示最近 300 条
          </Text>
        ) : null}

        <View style={styles.actions}>
          <FlatButton
            label={locating ? '正在取…' : '取一次位置'}
            onPress={() => {
              locate().catch(() => undefined);
            }}
            disabled={locating}
            style={styles.action}
          />
          <FlatButton
            label="刷新"
            onPress={() => {
              load().catch(() => undefined);
            }}
            disabled={busy}
            backgroundColor={surfaces.raised}
            textColor={colors.onSurface}
            style={styles.action}
          />
        </View>
        <Text
          style={[
            type.caption,
            styles.footer,
            {color: colors.onSurfaceVariant},
          ]}>
          记录只存在这台设备上，用于你和「{partner}」回看今天去了哪里。
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * App.tsx 一直按 `TrailScreen` 这个名字导入这个页面；导出别名保持兼容，
 * 页面本身按新设计叫 `Trail`。
 */
export const TrailScreen = Trail;

const styles = StyleSheet.create({
  root: {flex: 1},
  body: {paddingTop: 8},
  dateCard: {marginTop: 12, paddingHorizontal: 12, paddingVertical: 10},
  dateRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  dateText: {flex: 1},
  arrow: {paddingHorizontal: 4, paddingVertical: 2},
  arrowDisabled: {opacity: 0.35},
  todayPill: {paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999},
  pillLabel: {fontWeight: '700'},
  block: {marginTop: 12, paddingHorizontal: 14, paddingVertical: 12},
  blockHint: {marginTop: 4},
  summary: {marginTop: 14},
  actions: {flexDirection: 'row', gap: 12, marginTop: 16},
  action: {flex: 1},
  footer: {marginTop: 12},
});
