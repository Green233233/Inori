/**
 * 小狗端「权限管控中心」。
 *
 * 每一项都由系统层授予、随时可撤回；这里只展示真实状态、跳系统设置，并在
 * Android 13 及以下提供「随时查看屏幕」的常驻授权开关（每次查看仍会通知）。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {Pill} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {
  PERMISSION_KEYS,
  PermissionKey,
  PermissionStatus,
  qiDevicePermissions,
  qiAudit,
  qiGuard,
  qiScreenshot,
  AuditRecord,
} from '../../native/QiDevice';
import {qiLimits} from '../../native/QiLimits';
import type {AppLimitRules} from '../../native/QiLimits';
import {useQi} from '../qi/QiProvider';

const LABELS: Record<PermissionKey, {title: string; detail: string}> = {
  deviceAdmin: {title: '设备管理器', detail: '仅用于锁定屏幕，不会抹除设备'},
  accessibility: {
    title: '无障碍服务',
    detail: '只用来把被系统杀掉的守护服务拉回来，不读屏幕内容、不读输入',
  },
  usageAccess: {title: '使用情况访问', detail: '统计应用使用时长，同步时才读取'},
  overlay: {title: '悬浮窗', detail: '用于全屏消息，可随时关闭'},
  batteryUnrestricted: {title: '忽略电池优化', detail: '让守护连接不被系统频繁掐断'},
  notificationListener: {title: '通知使用权', detail: '除黑名单外默认转发通知，内容原样转发（不脱敏）'},
  exactAlarm: {title: '精确闹钟', detail: '让定时规则准时触发'},
  location: {title: '定位', detail: 'PASSIVE 复用为主，不持续 GPS'},
  photoShare: {title: '照片', detail: '只通过系统选择器分享你挑中的照片'},
  screenCaptureStanding: {
    title: '随时查看屏幕',
    detail: 'Android 13 及以下：开启后主人查看时你只会收到通知',
  },
};

export function PermissionCenter({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const [statuses, setStatuses] = useState<PermissionStatus[]>([]);
  const [standing, setStanding] = useState(false);
  const [apiLevel, setApiLevel] = useState(33);
  const [logs, setLogs] = useState<AuditRecord[]>([]);
  const [guardRunning, setGuardRunning] = useState(false);
  const [limits, setLimits] = useState<AppLimitRules | null>(null);
  const {sendAppLimit} = useQi();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const resolved = await Promise.all(
        PERMISSION_KEYS.map(key =>
          qiDevicePermissions
            .status(key)
            .catch(() => ({key, granted: false, revocable: false})),
        ),
      );
      setStatuses(resolved);
      const shot = await qiScreenshot.status().catch(() => null);
      if (shot) {
        setStanding(shot.standingEnabled);
        const rules = await qiLimits.getRules().catch(() => null);
        if (rules) {
          setLimits(rules);
        }
        setApiLevel(shot.apiLevel);
      }
      const guard = await qiGuard.status().catch(() => null);
      setGuardRunning(guard?.running === true);
      setLogs(await qiAudit.read(12, 0).catch(() => []));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const openSetting = async (key: PermissionKey) => {
    try {
      await qiDevicePermissions.openSettings(key);
      await qiAudit.append('permission.openSettings', key).catch(() => null);
    } catch (error: any) {
      showToast(error?.message ?? '无法打开系统设置');
    }
  };

  const toggleStanding = async (next: boolean) => {
    try {
      const result = await qiScreenshot.setStandingCapture(next);
      setStanding(result.standing);
      if (next && !result.standing) {
        showToast(result.note || '需要先在系统弹窗里允许屏幕共享');
      }
      await qiAudit.append('screenshot.standing', String(next)).catch(() => null);
    } catch (error: any) {
      showToast(error?.message ?? '设置失败');
    }
  };

  return (
    <View style={styles.root}>
      <TopBar title="权限管控中心" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.body, styles.intro, {color: colors.onSurfaceVariant}]}>
          授权与撤回永远由你决定。任何一项撤回都会立刻同步给主人端，且无法被远程恢复。
        </Text>

        <SoftCard radius={18} style={styles.card}>
          {statuses.map((status, index) => {
            const label = LABELS[status.key];
            const isStanding = status.key === 'screenCaptureStanding';
            const active = isStanding ? standing : status.granted;
            const disabled = isStanding && apiLevel >= 34;
            return (
              <View
                key={status.key}
                style={[
                  styles.row,
                  index > 0
                    ? {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.outline,
                      }
                    : null,
                ]}>
                <View style={{flex: 1}}>
                  <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                    {label.title}
                  </Text>
                  <Text
                    style={[
                      type.caption,
                      {color: colors.onSurfaceVariant, marginTop: 3},
                    ]}>
                    {label.detail}
                  </Text>
                </View>
                {isStanding ? (
                  <Switch
                    accessibilityLabel={label.title}
                    value={standing}
                    disabled={disabled}
                    onValueChange={next => {
                      toggleStanding(next).catch(() => undefined);
                    }}
                    trackColor={{true: colors.primary, false: colors.outline}}
                  />
                ) : (
                  <Pill
                    text={active ? '已授权' : '未授权'}
                    color={active ? colors.onPrimary : colors.onSurfaceVariant}
                    background={active ? colors.primary : colors.surfaceVariant}
                  />
                )}
                {!isStanding ? (
                  <Text
                    accessibilityRole="button"
                    accessibilityLabel={`打开 ${label.title} 设置`}
                    onPress={() => {
                      openSetting(status.key).catch(() => undefined);
                    }}
                    style={[type.label, styles.action, {color: colors.primary}]}>
                    去设置
                  </Text>
                ) : null}
              </View>
            );
          })}
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          守护与功耗
        </Text>
        <SoftCard radius={18} style={styles.card}>
          <View style={styles.row}>
            <View style={{flex: 1}}>
              <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                守护连接
              </Text>
              <Text
                style={[
                  type.caption,
                  {color: colors.onSurfaceVariant, marginTop: 3},
                ]}>
                息屏后自动降频，不持有唤醒锁；低电量会自动切到省电
              </Text>
            </View>
            <Switch
              accessibilityLabel="守护连接"
              value={guardRunning}
              onValueChange={async next => {
                try {
                  if (next) {
                    await qiGuard.start();
                  } else {
                    await qiGuard.stop();
                  }
                  setGuardRunning(next);
                } catch (error: any) {
                  showToast(error?.message ?? '切换失败');
                }
              }}
              trackColor={{true: colors.primary, false: colors.outline}}
            />
          </View>
        </SoftCard>

        <SoftCard radius={18} style={styles.card}>
          <View style={styles.row}>
            <View style={{flex: 1}}>
              <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                应用限制
              </Text>
              <Text
                style={[
                  type.caption,
                  {color: colors.onSurfaceVariant, marginTop: 3},
                ]}>
                {limits?.enabled
                  ? `主人限定了 ${limits.blocked.length} 个应用，打开时会被挡住`
                  : '主人没有限制任何应用；关掉后立即生效，主人那边也会看到'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="应用限制"
              value={limits?.enabled === true}
              onValueChange={async next => {
                const base = limits ?? {enabled: false, blocked: [], updatedAt: 0};
                const updated: AppLimitRules = {...base, enabled: next};
                setLimits(updated);
                try {
                  await sendAppLimit(updated);
                  showToast(next ? '已开启应用限制' : '已关闭应用限制');
                } catch (error: any) {
                  setLimits(base);
                  showToast(error?.message ?? '切换失败');
                }
              }}
              trackColor={{true: colors.primary, false: colors.outline}}
            />
          </View>
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          最近操作
        </Text>
        <SoftCard radius={18} style={styles.card}>
          {logs.length === 0 ? (
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              还没有记录。每次授权、查看与撤回都会写在这里。
            </Text>
          ) : (
            logs.map((record, index) => (
              <View
                key={record.hash + index}
                style={[
                  styles.logRow,
                  index > 0
                    ? {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.outline,
                      }
                    : null,
                ]}>
                <GlassIcon name="info" size={18} />
                <View style={{flex: 1}}>
                  <Text style={[type.caption, {color: colors.onSurface}]}>
                    {record.type}
                  </Text>
                  <Text
                    style={[type.caption, {color: colors.onSurfaceVariant}]}
                    numberOfLines={2}>
                    {record.at} · {record.detail || '—'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </SoftCard>

        <Text
          onPress={() => {
            refresh().catch(() => undefined);
          }}
          accessibilityRole="button"
          accessibilityLabel="刷新权限状态"
          style={[type.label, styles.refresh, {color: colors.onSurfaceVariant}]}>
          {refreshing ? '刷新中…' : '刷新状态'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginBottom: 14, marginTop: 4},
  card: {paddingVertical: 2, paddingHorizontal: 16},
  row: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14},
  action: {paddingHorizontal: 4, paddingVertical: 6},
  sectionTitle: {marginTop: 26, marginBottom: 10},
  logRow: {flexDirection: 'row', gap: 10, paddingVertical: 10, alignItems: 'flex-start'},
  refresh: {alignSelf: 'center', marginTop: 20, padding: 10},
});
