/**
 * 主人端「设备管控中心」。
 *
 * 所有数据都通过端到端加密命令向小狗端现取（不落服务器明文）；小狗端离线或未
 * 授权时如实提示，而不是显示假数据。
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {onAccentFor, withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {ColorField, SoftCard} from '../../components/Surfaces';
import {FlatButton, AppSheet} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';

type SheetKind = 'capture' | 'guard' | null;


export function ControlCenter({
  onBack,
  onOpenUsage,
}: {
  onBack: () => void;
  onOpenUsage: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, runCommand, refreshPair} = useQi();
  const [busy, setBusy] = useState<string | null>(null);
  const [capture, setCapture] = useState<any>(null);
  const [guard, setGuard] = useState<any>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [message, setMessage] = useState('');
  const [messageOpen, setMessageOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const call = useCallback(
    async (kind: any, args?: Record<string, unknown>) => {
      setBusy(kind);
      try {
        const reply = await runCommand(kind, args);
        refreshPair().catch(() => undefined);
        if (!reply.ok) {
          setHint(reply.error ?? '小狗端没有返回数据');
          showToast(reply.error ?? '小狗端没有返回数据');
          return null;
        }
        setHint(null);
        return reply.data;
      } catch (error: any) {
        setHint(error?.message ?? '请求失败');
        showToast(error?.message ?? '请求失败');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [runCommand, refreshPair],
  );

  const loadGuard = useCallback(async () => {
    const data: any = await call('guard.status');
    if (data) {
      setGuard(data);
    }
  }, [call]);

  useEffect(() => {
    if (pair?.verified) {
      loadGuard().catch(() => undefined);
    }
  }, [loadGuard, pair?.verified]);

  const actions = [
    {
      key: 'capture',
      icon: 'photo' as const,
      label: '查看屏幕',
      hint: '截取一张小狗端当前画面',
      onPress: async () => {
        const data: any = await call('screen.capture');
        if (data?.base64) {
          setCapture(data);
          setSheet('capture');
        }
      },
    },
    {
      key: 'usage',
      icon: 'flame' as const,
      label: '使用时长',
      hint: '今日屏幕时间与 Top 应用',
      onPress: () => {
        onOpenUsage();
      },
    },
    {
      key: 'message',
      icon: 'text' as const,
      label: '全屏消息',
      hint: '在小狗屏幕中央显示一句话',
      onPress: () => setMessageOpen(true),
    },
    {
      key: 'guard',
      icon: 'settings' as const,
      label: '守护状态',
      hint: '功耗档位与连接状态',
      onPress: async () => {
        await loadGuard();
        setSheet('guard');
      },
    },
  ];

  const sendMessage = async () => {
    const text = message.trim();
    if (!text) {
      return;
    }
    const ok = await call('overlay.show', {message: text, timeoutMs: 15000});
    if (ok !== null) {
      showToast('已经显示在小狗端屏幕上');
      setMessage('');
      setMessageOpen(false);
    }
  };

  return (
    <View style={styles.root}>
      <TopBar title="设备管控中心" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}>
        <ColorField color={colors.primary} radius={20} style={styles.hero}>
          <Text style={[type.caption, {color: withAlpha(onAccentFor(colors.primary), 0.85)}]}>
            已连接 · {pair?.puppyName || '小狗'}
          </Text>
          <Text style={[styles.heroTitle, {color: onAccentFor(colors.primary)}]}>
            {pair?.peerOnline ? '对方在线' : '对方离线'}
          </Text>
          <Text style={[type.caption, {color: withAlpha(onAccentFor(colors.primary), 0.8)}]}>
            电量 {pair?.peerBattery ?? '—'}% · 功耗
            {guard?.tier === 'saver' ? ' 省电' : guard?.tier === 'realtime' ? ' 实时' : ' 智能'}
          </Text>
        </ColorField>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          管控
        </Text>
        <View style={styles.grid}>
          {actions.map(action => (
            <SoftCard
              key={action.key}
              radius={18}
              onPress={() => {
                Promise.resolve(action.onPress()).catch(() => undefined);
              }}
              accessibilityLabel={action.label}
              style={styles.tile}>
              <GlassIcon name={action.icon} size={26} />
              <Text style={[type.bodyStrong, {color: colors.onSurface, marginTop: 8}]}>
                {action.label}
              </Text>
              <Text
                style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 2}]}
                numberOfLines={2}>
                {action.hint}
              </Text>
              {busy === action.key ? (
                <Text style={[type.caption, {color: colors.primary, marginTop: 6}]}>
                  请求中…
                </Text>
              ) : null}
            </SoftCard>
          ))}
        </View>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          数据查看
        </Text>
        <SoftCard radius={18} style={styles.dataCard}>
          <View style={styles.dataRow}>
            <Text style={[type.body, {color: colors.onSurface}]}>今日屏幕时间</Text>
            <Text style={[type.bodyStrong, {color: colors.primary}]}>看使用时长 →</Text>
          </View>
          {hint ? (
            <Text style={[type.caption, {color: colors.error, marginTop: 8}]}>
              {hint}
            </Text>
          ) : null}
        </SoftCard>

        <Text
          style={[type.caption, styles.footnote, {color: colors.onSurfaceVariant}]}>
          每次查看都会在小狗端留下记录并通知；截图、全屏消息有频率上限。
        </Text>
      </ScrollView>

      <AppSheet visible={sheet === 'capture'} title="小狗的屏幕" onClose={() => setSheet(null)}>
        {capture?.base64 ? (
          <Image
            source={{uri: `data:image/jpeg;base64,${capture.base64}`}}
            style={styles.capture}
            resizeMode="contain"
          />
        ) : (
          <Text style={[type.body, {color: colors.onSurfaceVariant}]}>没有画面</Text>
        )}
        <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 8}]}>
          {capture?.width}×{capture?.height} · 小狗端已收到查看通知
        </Text>
      </AppSheet>

      <AppSheet visible={sheet === 'guard'} title="守护状态" onClose={() => setSheet(null)}>
        <StatusLine label="运行中" value={guard?.running ? '是' : '否'} colors={colors} />
        <StatusLine label="功耗档位" value={guard?.tier ?? '—'} colors={colors} />
        <StatusLine label="轮询间隔" value={`${guard?.waitMs ?? '—'} ms`} colors={colors} />
        <StatusLine label="屏幕" value={guard?.screenOn ? '点亮' : '熄灭'} colors={colors} />
        <StatusLine label="电量" value={`${guard?.batteryPercent ?? '—'}%`} colors={colors} />
        <View style={styles.tierRow}>
          {(['saver', 'balanced', 'realtime'] as const).map(tier => (
            <FlatButton
              key={tier}
              label={tier === 'saver' ? '省电' : tier === 'balanced' ? '智能' : '实时'}
              onPress={() => {
                call('guard.tier', {tier}).then(loadGuard).catch(() => undefined);
              }}
              style={styles.tierButton}
              backgroundColor={
                guard?.tier === tier ? colors.primary : colors.surfaceVariant
              }
              textColor={guard?.tier === tier ? colors.onPrimary : colors.onSurface}
            />
          ))}
        </View>
      </AppSheet>

      <AppSheet
        visible={messageOpen}
        title="全屏消息"
        onClose={() => setMessageOpen(false)}
        footer={<FlatButton label="发送" onPress={sendMessage} />}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="例如：该休息啦"
          placeholderTextColor={colors.onSurfaceVariant}
          maxLength={60}
          accessibilityLabel="全屏消息内容"
          style={[
            styles.messageInput,
            {
              color: colors.onSurface,
              backgroundColor: colors.surfaceVariant,
              borderColor: colors.outline,
            },
          ]}
        />
        <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 8}]}>
          会在小狗屏幕中央显示 15 秒，对方可以立刻关掉。
        </Text>
      </AppSheet>
    </View>
  );
}

function StatusLine({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: any;
}) {
  return (
    <View style={styles.statusLine}>
      <Text style={[type.body, {color: colors.onSurfaceVariant}]}>{label}</Text>
      <Text style={[type.bodyStrong, {color: colors.onSurface}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  hero: {padding: 20, minHeight: 130, justifyContent: 'center', marginTop: 4},
  heroTitle: {fontSize: 26, fontWeight: '800', marginTop: 6, marginBottom: 6},
  sectionTitle: {marginTop: 24, marginBottom: 10},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  tile: {width: '48%', padding: 16, minHeight: 118},
  dataCard: {padding: 16},
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  divider: {height: StyleSheet.hairlineWidth, marginVertical: 12},
  footnote: {marginTop: 18, lineHeight: 20},
  capture: {width: '100%', height: 320, borderRadius: 12, backgroundColor: '#000'},
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  noteRow: {paddingVertical: 8},
  statusLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },
  tierRow: {flexDirection: 'row', gap: 8, marginTop: 14},
  tierButton: {flex: 1, height: 42},
  messageInput: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
});
