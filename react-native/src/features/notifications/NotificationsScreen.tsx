/**
 * 通知转发（主人端）：拉取小狗端队列里的通知，合并进本机历史。
 *
 * 拉取走端到端加密的命令通道；本机历史不落服务器，清空只影响这台设备。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {AppDialog, FlatButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {
  clearNotifications,
  loadNotifications,
  mergeNotifications,
  NotificationRecord,
} from '../../data/notificationHistory';

function packageLabel(pkg: string): string {
  const parts = pkg.split('.');
  return parts[parts.length - 1] || pkg;
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotificationsScreen({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {role, pair, runCommand} = useQi();
  const isMaster = role === 'MASTER';
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  // v0.6.8：只认 pairId。pair 对象每次 refreshPair 都会换新，若直接进依赖数组，
  // 这个 effect 会在每次 relay 心跳后重跑，看起来就是「通知转发一直在刷新」。
  const pairId = pair?.pairId;
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (options?: {silent?: boolean}) => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      if (isMaster && pairId) {
        const drained = await runCommand('notifications.drain', {limit: 100});
        const events = Array.isArray(drained?.data)
          ? (drained.data as NotificationRecord[])
          : [];
        setItems(await mergeNotifications(events));
      } else {
        setItems(await loadNotifications());
      }
    } catch (error: any) {
      showToast(error?.message ?? '拉取失败');
      setItems(await loadNotifications());
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [isMaster, pairId, runCommand]);

  useEffect(() => {
    // 首屏拉一次即可；后续靠下拉/按钮，不再跟着 pair 身份重跑。
    refresh({silent: true}).catch(() => undefined);
  }, [isMaster, pairId, refresh]);

  return (
    <View style={styles.root}>
      <TopBar title="通知转发" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              refresh().catch(() => undefined);
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}>
        <Text style={[type.body, styles.intro, {color: colors.onSurfaceVariant}]}>
          {isMaster
            ? '下拉拉取小狗端新转发的通知；除黑名单外默认全部转发，不再打码。'
            : '通知由小狗端转发到主人端；你可以在「响应配置」里维护黑名单。'}
        </Text>

        {isMaster ? (
          <FlatButton
            label="拉取新通知"
            onPress={() => {
              refresh().catch(() => undefined);
            }}
            style={styles.primary}
          />
        ) : null}

        {items.length === 0 ? (
          <SoftCard radius={18} style={styles.empty}>
            <GlassIcon name="info" size={34} />
            <Text
              style={[
                type.body,
                {color: colors.onSurfaceVariant, marginTop: 10, textAlign: 'center'},
              ]}>
              {isMaster
                ? '还没有转发记录。确认小狗端已开启通知使用权（黑名单外的应用会默认转发）。'
                : '小狗端暂不展示历史，通知只在主人端可见。'}
            </Text>
          </SoftCard>
        ) : (
          <>
            <Text
              style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
              最近转发
            </Text>
            {items.map(item => (
              <SoftCard
                key={`${item.at}-${item.pkg}-${item.text.slice(0, 8)}`}
                radius={14}
                style={styles.card}>
                <View style={styles.row}>
                  <Text
                    style={[type.caption, styles.pkg, {color: colors.onSurfaceVariant}]}>
                    {packageLabel(item.pkg)}
                  </Text>
                  <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
                    {timeLabel(item.at)}
                  </Text>
                </View>
                {item.title ? (
                  <Text
                    style={[type.bodyStrong, {color: colors.onSurface, marginTop: 4}]}
                    numberOfLines={1}>
                    {item.title}
                  </Text>
                ) : null}
                <Text
                  style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 2}]}>
                  {item.text}
                </Text>
              </SoftCard>
            ))}
            <FlatButton
              label="清空本机记录"
              onPress={() => setConfirmClear(true)}
              backgroundColor={colors.surfaceVariant}
              textColor={withAlpha(colors.error, 0.9)}
              style={styles.clear}
            />
          </>
        )}
      </ScrollView>

      <AppDialog
        visible={confirmClear}
        title="清空本机记录？"
        message="只删除这台设备上的转发历史，不影响对方。"
        confirmLabel="清空"
        dismissLabel="取消"
        destructive
        onDismiss={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          clearNotifications()
            .then(() => setItems([]))
            .catch(() => showToast('清空失败'));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginTop: 4, marginBottom: 12},
  primary: {height: 46},
  empty: {padding: 24, alignItems: 'center', marginTop: 14},
  sectionTitle: {marginTop: 20, marginBottom: 10},
  card: {padding: 12, marginBottom: 8},
  row: {flexDirection: 'row', justifyContent: 'space-between'},
  pkg: {fontWeight: '600'},
  clear: {marginTop: 16, height: 44},
});
