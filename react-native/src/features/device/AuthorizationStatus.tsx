/**
 * 主人端「查看授权状态」。
 *
 * 只读页：向小狗端请求一次权限快照（relay 命令 permissions.snapshot），
 * 把每一项当前是否被授予原样列出来，并标明「随时可能被撤回」。
 * 这里不做任何授权动作——授权永远只发生在小狗端的系统设置里。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {Pill, FlatButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {PERMISSION_KEYS, PermissionEntry, PermissionKey} from '../../native/QiDevice';

const LABELS: Record<PermissionKey, string> = {
  deviceAdmin: '设备管理器',
  accessibility: '无障碍服务',
  usageAccess: '使用情况访问',
  overlay: '悬浮窗',
  batteryUnrestricted: '忽略电池优化',
  notificationListener: '通知使用权',
  exactAlarm: '精确闹钟',
  location: '定位',
  photoShare: '照片',
  screenCaptureStanding: '随时查看屏幕',
};

function formatTime(at: number | null): string {
  if (!at) {
    return '还没有查过';
  }
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())} 更新`;
}

export function AuthorizationStatus({onBack}: {onBack: () => void}) {
  const {colors} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, runCommand, refreshPair} = useQi();
  const [entries, setEntries] = useState<PermissionEntry[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const reply = await runCommand('permissions.snapshot');
      refreshPair().catch(() => undefined);
      if (!reply.ok) {
        setHint(reply.error ?? '小狗端没有返回权限状态');
        return;
      }
      const list = Array.isArray(reply.data) ? (reply.data as PermissionEntry[]) : [];
      setEntries(list);
      setAt(Date.now());
      setHint(null);
    } catch (error: any) {
      setHint(error?.message ?? '请求失败');
    } finally {
      setBusy(false);
    }
  }, [runCommand, refreshPair]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const grantedCount = entries?.filter(entry => entry.granted).length ?? 0;
  const total = entries?.length ?? PERMISSION_KEYS.length;

  const ask = () => {
    showToast('授权只能小狗端自己操作，你这边只能查看');
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <TopBar title="查看授权状态" onBack={onBack} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {paddingBottom: insets.bottom + 32},
        ]}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
          小狗端的每一项权限都由它自己授予；撤回会立刻反映到这里。你这边只能查看，不能远程打开任何一项。
        </Text>

        <SoftCard radius={18} style={styles.hero}>
          <View style={styles.heroRow}>
            <GlassIcon name="info" size={26} />
            <View style={{flex: 1}}>
              <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                已授予 {grantedCount} / {total}
              </Text>
              <Text
                style={[
                  type.caption,
                  {color: colors.onSurfaceVariant, marginTop: 4},
                ]}>
                {formatTime(at)}
                {pair?.puppyName ? ` · ${pair.puppyName}` : ''}
              </Text>
            </View>
            <Pill
              text={pair?.peerOnline ? '在线' : '离线'}
              color={pair?.peerOnline ? colors.onPrimary : colors.onSurfaceVariant}
              background={
                pair?.peerOnline ? colors.primary : colors.surfaceVariant
              }
            />
          </View>
        </SoftCard>

        {hint ? (
          <Text style={[type.caption, {color: colors.error, marginTop: 12}]}>
            {hint}
          </Text>
        ) : null}

        <Text
          style={[
            type.label,
            {color: colors.onSurfaceVariant, marginTop: 20, marginBottom: 8},
          ]}>
          十项权限
        </Text>

        {entries
          ? entries.map((entry, index) => (
              <SoftCard
                key={entry.key}
                radius={16}
                style={[
                  styles.row,
                  index === entries.length - 1 ? styles.rowLast : null,
                ]}>
                <View style={styles.rowInner}>
                  <GlassIcon
                    name={entry.granted ? 'check' : 'circle'}
                    size={20}
                  />
                  <View style={{flex: 1}}>
                    <Text style={[type.body, {color: colors.onSurface}]}>
                      {LABELS[entry.key] ?? entry.key}
                    </Text>
                  </View>
                  <Pill
                    text={entry.granted ? '已授权' : '未授权'}
                    color={
                      entry.granted ? colors.onPrimary : colors.onSurfaceVariant
                    }
                    background={
                      entry.granted ? colors.primary : colors.surfaceVariant
                    }
                  />
                </View>
              </SoftCard>
            ))
          : PERMISSION_KEYS.map(key => (
              <SoftCard key={key} radius={16} style={styles.row}>
                <View style={styles.rowInner}>
                  <GlassIcon name="circle" size={20} />
                  <Text style={[type.body, {color: colors.onSurfaceVariant, flex: 1}]}>
                    {LABELS[key]}
                  </Text>
                  <Pill
                    text={busy ? '查询中' : '未知'}
                    color={colors.onSurfaceVariant}
                    background={colors.surfaceVariant}
                  />
                </View>
              </SoftCard>
            ))}

        <FlatButton
          label={busy ? '正在向小狗端查询…' : '刷新状态'}
          disabled={busy}
          textColor={colors.primary}
          backgroundColor={colors.surfaceVariant}
          onPress={() => load().catch(() => undefined)}
          style={{marginTop: 18}}
        />
        <FlatButton
          label="为什么不能由我打开？"
          textColor={colors.onSurfaceVariant}
          backgroundColor={colors.surfaceVariant}
          onPress={ask}
          style={{marginTop: 8}}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {paddingHorizontal: 18, paddingTop: 6},
  hero: {marginTop: 14},
  heroRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  row: {marginTop: 8, paddingVertical: 12, paddingHorizontal: 14},
  rowLast: {marginBottom: 4},
  rowInner: {flexDirection: 'row', alignItems: 'center', gap: 12},
});
