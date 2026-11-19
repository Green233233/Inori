/**
 * 小狗端屏幕时间详情（独立二级页面）。
 *
 * 数据仍然通过端到端加密命令现取（`usage.stats`），不落服务器明文；小狗端离线、
 * 未授权或关闭共享时如实提示。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {HourlyBars} from '../../components/HourlyBars';
import {SoftCard} from '../../components/Surfaces';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {useQi} from '../qi/QiProvider';

export function UsageStatsScreen({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, runCommand, refreshPair} = useQi();
  const [usage, setUsage] = useState<any>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      setBusy(true);
      try {
        const reply = await runCommand('usage.stats');
        refreshPair().catch(() => undefined);
        if (!reply.ok) {
          setUsage(null);
          setHint(reply.error ?? '小狗端没有返回数据');
          return;
        }
        setUsage(reply.data);
        setHint(null);
      } catch (error: any) {
        setUsage(null);
        setHint(error?.message ?? '请求失败');
        if (!silent) {
          showToast('没拿到使用时长');
        }
      } finally {
        setBusy(false);
      }
    },
    [runCommand, refreshPair],
  );

  useEffect(() => {
    load(true).catch(() => undefined);
  }, [load]);

  const top: any[] = usage?.top ?? [];
  const partner = pair?.puppyName ?? '小狗';

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <TopBar title="使用时长" onBack={onBack} />
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
        <Text
          style={[
            type.caption,
            {color: colors.onSurfaceVariant, marginBottom: 12},
          ]}>
          数据来自{partner}的「使用情况访问」，每次只在你要看的时候读一次。
        </Text>

        <SoftCard>
          <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
            今天 {Math.round(usage?.today?.totalMinutes ?? 0)} 分钟
          </Text>
          <Text
            style={[
              type.caption,
              {color: colors.onSurfaceVariant, marginTop: 4},
            ]}>
            近 7 天 {Math.round(usage?.week?.totalMinutes ?? 0)} 分钟
          </Text>
          <HourlyBars hours={usage?.hours} />
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

        <Text
          style={[
            type.bodyStrong,
            {color: colors.onSurface, marginTop: 18, marginBottom: 8},
          ]}>
          用得最多的应用
        </Text>
        <SoftCard>
          {top.length === 0 ? (
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              还没有数据。{partner}开启「使用情况访问」后这里会显示 Top 应用。
            </Text>
          ) : (
            top.map(item => (
              <View
                key={item.package ?? item.pkg}
                style={[styles.row, {borderColor: colors.outline}]}>
                <Text
                  style={[type.body, {color: colors.onSurface, flex: 1}]}
                  numberOfLines={1}>
                  {item.label ?? item.package ?? item.pkg}
                </Text>
                <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                  {Math.round(item.minutes ?? 0)} 分钟
                </Text>
              </View>
            ))
          )}
        </SoftCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
