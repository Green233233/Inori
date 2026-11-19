/**
 * 主人端「小狗轨迹」。
 *
 * 两段信息都来自小狗端的真实授权数据：
 * 1. 使用时段：向小狗端取 usage.stats，把今天每小时屏幕时间画成柱状；
 * 2. 位置采样：每次主人在管控中心取过位置就会本地留一笔，位移超过 500 米算一次出行。
 *
 * 页面不会主动后台定位，也不会定时拉取——只在小狗端在线时现取一次。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {SoftCard} from '../../components/Surfaces';
import {FlatButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {MapPreview} from '../../components/MapPreview';
import {useQi} from '../qi/QiProvider';
import {
  clearTrail,
  loadTrail,
  recordTrailPoint,
  trailMoves,
  type TrailPoint,
} from '../../data/trailStore';

type HourBucket = {hour: number; minutes: number};

function formatTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TrailScreen({onBack}: {onBack: () => void}) {
  const {colors} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state, runCommand} = useQi();
  const partner = state.pair?.puppyName || '小狗';

  const [hours, setHours] = useState<HourBucket[]>([]);
  const [points, setPoints] = useState<TrailPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  /** 最近一次主动取到的位置（含逆地理地址），只存在本机。 */
  const [latest, setLatest] = useState<{
    lat: number;
    lng: number;
    address: string;
    at: number;
  } | null>(null);

  const refreshLocal = useCallback(async () => {
    setPoints(await loadTrail());
  }, []);

  const refreshUsage = useCallback(async () => {
    setLoading(true);
    try {
      const reply = await runCommand('usage.stats');
      if (reply?.ok) {
        const data = reply.data as {hours?: HourBucket[]};
        setHours(Array.isArray(data?.hours) ? data.hours : []);
      } else {
        showToast(reply?.error || '小狗端没有响应');
      }
    } finally {
      setLoading(false);
    }
  }, [runCommand]);

  useEffect(() => {
    void refreshLocal();
    void refreshUsage();
  }, [refreshLocal, refreshUsage]);

  /**
   * 向小狗端现取一次位置：拿到的地址直接当主文案，同时补一笔到轨迹里，
   * 这样「地图 + 文字地址」和「位置采样」看到的是同一个点。
   */
  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const reply = await runCommand('location.get');
      const data = reply?.data as
        | {lat?: number; lng?: number; address?: string; addressSource?: string}
        | undefined;
      const lat = Number(data?.lat);
      const lng = Number(data?.lng);
      if (!reply?.ok || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        showToast(reply?.error || '小狗端暂时没有可用的位置');
        return;
      }
      const address =
        (data?.address || '').trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const at = Date.now();
      setLatest({lat, lng, address, at});
      await recordTrailPoint({at, lat, lng, address}).catch(() => undefined);
      await refreshLocal();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '取位置失败，小狗端可能不在线',
      );
    } finally {
      setLocating(false);
    }
  }, [refreshLocal, runCommand]);

  const moves = trailMoves(points);
  const peak = Math.max(1, ...hours.map(item => item.minutes));
  const busiest = hours.length > 0 ? hours.reduce((best, item) => (item.minutes > best.minutes ? item : best), hours[0]) : null;
  const activeHours = hours.filter(item => item.minutes >= 5);

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <TopBar title="小狗轨迹" onBack={onBack} />
      <ScrollView
        contentContainerStyle={[styles.body, {paddingBottom: insets.bottom + 32}]}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          使用时段实时取一次；位置在你取过之后才会留痕，日常只在后台低频采样。
        </Text>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>小狗现在在哪</Text>
        <SoftCard>
          {latest ? (
            <>
              <MapPreview
                lat={latest.lat}
                lng={latest.lng}
                height={168}
                label={
                  latest.address.startsWith(String(latest.lat.toFixed(4)))
                    ? null
                    : latest.address
                }
              />
              <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 8}]}>
                {latest.address} · {formatTime(latest.at)} 取的
              </Text>
            </>
          ) : (
            <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
              还没取过位置。点一下下面的按钮，向小狗端现取一次；取到后地图和文字地址都会留在这里。
            </Text>
          )}
          <View style={styles.actions}>
            <FlatButton
              label={locating ? '正在取…' : '取一次位置'}
              onPress={() => void locate()}
              disabled={locating}
            />
          </View>
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>使用时段</Text>
        <SoftCard>
          {busiest ? (
            <Text style={[type.body, {color: colors.onSurface}]}>
              最忙是 {busiest.hour} 点（{busiest.minutes} 分钟）
            </Text>
          ) : (
            <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
              {loading ? '正在读取…' : '今天还没有可读的使用记录。'}
            </Text>
          )}
          {hours.length === 24 ? (
            <>
              <View style={styles.bars}>
                {hours.map(item => (
                  <View key={item.hour} style={styles.barSlot}>
                    <View
                      style={{
                        width: '100%',
                        height: Math.max(2, (item.minutes / peak) * 56),
                        borderRadius: 3,
                        backgroundColor: item.minutes > 0 ? colors.primary : colors.surfaceVariant,
                        opacity: item.minutes > 0 ? 0.35 + 0.65 * (item.minutes / peak) : 0.5,
                      }}
                    />
                  </View>
                ))}
              </View>
              <View style={styles.axis}>
                {[0, 6, 12, 18, 23].map(hour => (
                  <Text key={hour} style={[type.caption, {color: colors.onSurfaceVariant}]}>
                    {hour}
                  </Text>
                ))}
              </View>
            </>
          ) : null}
          {activeHours.length > 0 ? (
            <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 8}]}>
              活跃时段：
              {activeHours.map(item => `${item.hour} 点`).join('、')}
            </Text>
          ) : null}
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>位置采样</Text>
        <SoftCard>
          {points.length === 0 ? (
            <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
              还没有采到位置。上面点一次「取一次位置」，这里就会留下一条记录。
            </Text>
          ) : (
            points
              .slice()
              .reverse()
              .map(point => (
                <View key={point.at} style={styles.row}>
                  <Text style={[type.body, {color: colors.onSurface}]}>{formatTime(point.at)}</Text>
                  <Text style={[type.caption, {color: colors.onSurfaceVariant, flex: 1, textAlign: 'right'}]}>
                    {point.address || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`}
                  </Text>
                </View>
              ))
          )}
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>出行（位移 &gt; 500 米）</Text>
        <SoftCard>
          {moves.length === 0 ? (
            <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
              还没有超过 500 米的位移记录。
            </Text>
          ) : (
            moves
              .slice()
              .reverse()
              .map(move => (
                <View key={`${move.from.at}-${move.to.at}`} style={styles.moveRow}>
                  <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                    {formatTime(move.from.at)} → {formatTime(move.to.at)}
                  </Text>
                  <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
                    {move.from.address || `${move.from.lat.toFixed(4)}, ${move.from.lng.toFixed(4)}`} →{' '}
                    {move.to.address || `${move.to.lat.toFixed(4)}, ${move.to.lng.toFixed(4)}`}
                    {'（约 '}
                    {(move.distanceM / 1000).toFixed(1)} 公里）
                  </Text>
                </View>
              ))
          )}
        </SoftCard>

        <View style={styles.actions}>
          <FlatButton
            label={loading ? '刷新中…' : '刷新'}
            onPress={() => {
              void refreshLocal();
              void refreshUsage();
            }}
            disabled={loading}
          />
          {points.length > 0 ? (
            <FlatButton
              label="清空记录"
                onPress={async () => {
                await clearTrail();
                await refreshLocal();
                showToast('已清空本机的轨迹记录');
              }}
            />
          ) : null}
        </View>
        <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 12}]}>
          记录只存在这台设备上，用于你和「{partner}」回看今天去了哪里。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  body: {paddingHorizontal: 20, paddingTop: 8},
  sectionTitle: {marginTop: 20, marginBottom: 10},
  bars: {flexDirection: 'row', alignItems: 'flex-end', height: 64, marginTop: 10, gap: 2},
  barSlot: {flex: 1},
  axis: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 2},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6},
  moveRow: {paddingVertical: 8, gap: 2},
  actions: {flexDirection: 'row', gap: 12, marginTop: 16},
});
