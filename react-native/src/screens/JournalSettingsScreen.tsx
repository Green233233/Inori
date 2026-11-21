/**
 * 日记设置：从「设置」搬进日记板块。
 * 字号、默认字体、默认笔刷，以及日记云同步的用量。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {type} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {TopBar} from '../components/TopBar';
import {AppSheet, Divider} from '../components/Ui';
import {SoftCard} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {fetchCloudQuota} from '../sync/staging';
import {useQi} from '../features/qi/QiProvider';
import {
  AppSettings,
  DefaultBrush,
  DefaultFont,
} from '../data/types';

const FONT_SIZES = [
  {label: '小', value: 14, hint: '字体较小，但显示内容更多'},
  {label: '中', value: 16, hint: '默认字号，开发者严选，纯人工零天然'},
  {label: '大', value: 18, hint: '说实话挺大的'},
  {label: '特大', value: 20, hint: '老花了啊喂'},
];

const FONT_FAMILIES: {label: string; value: DefaultFont; hint: string}[] = [
  {label: '衬线', value: 'serif', hint: '默认形式，感觉更有质感嘿嘿'},
  {label: '无衬线', value: 'sans', hint: '是很冷峻现代的风格'},
  {label: '圆体', value: 'round', hint: '可爱就是正义！'},
];

const BRUSHES: {label: string; value: DefaultBrush; hint: string}[] = [
  {label: '钢笔', value: 'pen', hint: '比较细'},
  {label: '马克笔', value: 'marker', hint: '很粗哦'},
  {label: '铅笔', value: 'pencil', hint: '质感不太一样'},
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`;
}

export function JournalSettingsScreen({
  settings,
  onChange,
  onBack,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onBack: () => void;
}) {
  const {colors} = useAppTheme();
  const {pair, stage} = useQi();
  const [sheet, setSheet] = useState<'size' | 'font' | 'brush' | null>(null);
  const [quota, setQuota] = useState<{quotaBytes: number; usedBytes: number} | null>(
    null,
  );
  const cloudReady = stage === 'ready' && !!pair;

  const loadQuota = useCallback(async () => {
    if (!pair) {
      setQuota(null);
      return;
    }
    try {
      const next = await fetchCloudQuota();
      setQuota({quotaBytes: next.quotaBytes, usedBytes: next.cloudUsedBytes});
    } catch {
      setQuota(null);
    }
  }, [pair]);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  const usedRatio =
    quota && quota.quotaBytes > 0
      ? Math.min(1, Math.max(0, quota.usedBytes / quota.quotaBytes))
      : 0;

  const update = (patch: Partial<AppSettings>) => {
    onChange({...settings, ...patch});
  };

  const fontLabel =
    FONT_FAMILIES.find(item => item.value === settings.defaultFont)?.label ??
    '衬线';
  const brushLabel =
    BRUSHES.find(item => item.value === settings.defaultBrush)?.label ?? '钢笔';

  return (
    <View style={styles.root}>
      <TopBar title="日记设置" onBack={onBack} titleSize={26} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
          已经写完的内容不会被影响哦
        </Text>

        <SoftCard style={styles.card}>
          <Row
            label="字体大小"
            value={`${settings.fontSize}sp`}
            onPress={() => setSheet('size')}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="默认字体"
            value={fontLabel}
            onPress={() => setSheet('font')}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <Row
            label="默认笔刷"
            value={brushLabel}
            onPress={() => setSheet('brush')}
          />
        </SoftCard>

        <SoftCard style={styles.card}>
          <Row
            label="日记云同步"
            value={cloudReady ? '已开启' : '未开启'}
            subtitle={
              cloudReady
                ? '私密日记也会加密备份，但只有你能解开'
                : '登录并完成绑定后才能使用云空间'
            }
            onPress={() => {
              if (!cloudReady) {
                showToast('先登录并完成绑定，再回来看看这里');
                return;
              }
              void loadQuota();
              showToast('已刷新云空间用量');
            }}
          />
          <Divider color={withAlpha(colors.outline, 0.3)} />
          <View style={styles.cloudUsage}>
            <View style={styles.cloudUsageHead}>
              <Text style={[type.body, {color: colors.onSurface}]}>已用空间</Text>
              <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
                {quota
                  ? `${formatBytes(quota.usedBytes)} / ${formatBytes(quota.quotaBytes)}`
                  : cloudReady
                    ? '正在读取…'
                    : '1 GB / 每对绑定'}
              </Text>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="日记云空间用量"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(usedRatio * 100),
              }}
              style={[
                styles.cloudBar,
                {backgroundColor: withAlpha(colors.outline, 0.25)},
              ]}>
              <View
                style={[
                  styles.cloudBarFill,
                  {
                    width: `${Math.round(usedRatio * 100)}%`,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              共享日记双方可见；私密日记只上传密文，对方和服务端都看不到内容
            </Text>
          </View>
        </SoftCard>

        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          这些设置只会影响新建的日记，已写完的内容不会被影响哦
        </Text>
      </ScrollView>

      <AppSheet
        visible={sheet === 'size'}
        title="字体大小"
        onClose={() => setSheet(null)}>
        {FONT_SIZES.map(item => (
          <Row
            key={item.value}
            label={item.label}
            subtitle={item.hint}
            value={settings.fontSize === item.value ? '已选' : ''}
            onPress={() => {
              update({fontSize: item.value});
              setSheet(null);
              showToast(`字体大小已设置为 ${item.value}sp啦`);
            }}
          />
        ))}
      </AppSheet>

      <AppSheet
        visible={sheet === 'font'}
        title="默认字体"
        onClose={() => setSheet(null)}>
        {FONT_FAMILIES.map(item => (
          <Row
            key={item.value}
            label={item.label}
            subtitle={item.hint}
            value={settings.defaultFont === item.value ? '已选' : ''}
            onPress={() => {
              update({defaultFont: item.value});
              setSheet(null);
              showToast(`默认字体已设为${item.label}啦`);
            }}
          />
        ))}
      </AppSheet>

      <AppSheet
        visible={sheet === 'brush'}
        title="默认笔刷"
        onClose={() => setSheet(null)}>
        {BRUSHES.map(item => (
          <Row
            key={item.value}
            label={item.label}
            subtitle={item.hint}
            value={settings.defaultBrush === item.value ? '已选' : ''}
            onPress={() => {
              update({defaultBrush: item.value});
              setSheet(null);
              showToast(`默认笔刷已设为${item.label}啦`);
            }}
          />
        ))}
      </AppSheet>
    </View>
  );
}

function Row({
  label,
  subtitle,
  value,
  onPress,
}: {
  label: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[type.body, {color: colors.onSurface}]}>{label}</Text>
        {subtitle ? (
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          {value}
        </Text>
      ) : null}
      <GlassIcon name="chevronRight" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cloudUsage: {paddingHorizontal: 18, paddingVertical: 14, gap: 10},
  cloudUsageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cloudBar: {height: 8, borderRadius: 999, overflow: 'hidden'},
  cloudBarFill: {height: '100%', borderRadius: 999},
  root: {flex: 1},
  body: {padding: 16, gap: 12},
  card: {paddingVertical: 4},
  row: {
    minHeight: 56,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowText: {flex: 1, gap: 2},
});

export default JournalSettingsScreen;
