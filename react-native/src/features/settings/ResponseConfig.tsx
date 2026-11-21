/**
 * 小狗端「响应配置」：决定主人能拿到什么、以什么频率拿到。
 *
 * 所有开关都会立刻生效——命令执行器在收到请求时会读取这些策略，关闭后主人端会
 * 收到明确的拒绝理由，而不是静默失败。
 */
import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Switch, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {FlatButton, Pill} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {qiDevice} from '../../native/QiDevice';

const TIERS = [
  {key: 'saver', label: '省电', hint: '15 分钟（最省电哒）'},
  {key: 'balanced', label: '智能', hint: '息屏会自动降频（推荐）'},
  {key: 'realtime', label: '实时', hint: '25 秒（对小狗手机的续航有很大影响哦）'},
] as const;

export function ResponseConfig({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {state, setPowerTier, setPolicy} = useQi();
  const [tier, setTier] = useState<'saver' | 'balanced' | 'realtime'>(
    state.powerTier === 'SAVER'
      ? 'saver'
      : state.powerTier === 'REALTIME'
        ? 'realtime'
        : 'balanced',
  );
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [relayStatus, setRelayStatus] = useState<any>(null);
  const [pkg, setPkg] = useState('');

  useEffect(() => {
    qiDevice.notifications
      .getBlocklist()
      .then(setBlocklist)
      .catch(() => undefined);
    qiDevice.notifications
      .status()
      .then(setRelayStatus)
      .catch(() => undefined);
  }, []);

  const chooseTier = async (next: 'saver' | 'balanced' | 'realtime') => {
    setTier(next);
    try {
      await qiDevice.guard.setTier(next);
      await setPowerTier(
        next === 'saver' ? 'SAVER' : next === 'realtime' ? 'REALTIME' : 'BALANCED',
      );
      showToast('已切换功耗档位');
    } catch (error: any) {
      showToast(error?.message ?? '切换失败QAQ');
    }
  };

  const addPackage = async () => {
    const name = pkg.trim();
    if (!name || blocklist.includes(name)) {
      return;
    }
    const next = [...blocklist, name];
    try {
      await qiDevice.notifications.setBlocklist(next);
      setBlocklist(next);
      setPkg('');
      showToast('已加入黑名单');
    } catch (error: any) {
      showToast(error?.message ?? '添加失败QAQ');
    }
  };

  const removePackage = async (name: string) => {
    const next = blocklist.filter(item => item !== name);
    try {
      await qiDevice.notifications.setBlocklist(next);
      setBlocklist(next);
    } catch (error: any) {
      showToast(error?.message ?? '移除失败QAQ');
    }
  };

  return (
    <View style={styles.root}>
      <TopBar title="响应配置" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.body, styles.intro, {color: colors.onSurfaceVariant}]}>
          只有小狗自己能决定主人能看到什么。开关会立即生效，关闭后主人会收到明确的拒绝理由。
        </Text>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          连接频率
        </Text>
        <SoftCard radius={18} style={styles.card}>
          <View style={styles.tierRow}>
            {TIERS.map(item => (
              <FlatButton
                key={item.key}
                label={item.label}
                onPress={() => {
                  chooseTier(item.key).catch(() => undefined);
                }}
                style={styles.tierButton}
                backgroundColor={
                  tier === item.key ? colors.primary : colors.surfaceVariant
                }
                textColor={
                  tier === item.key ? colors.onPrimary : colors.onSurface
                }
              />
            ))}
          </View>
          <Text
            style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 10}]}>
            {TIERS.find(item => item.key === tier)?.hint}
            。低电量会自动切到省电。
          </Text>
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          共享开关
        </Text>
        <SoftCard radius={18} style={styles.card}>
          <ToggleRow
            title="使用时长"
            detail="允许主人查看今日屏幕时间与 Top 应用"
            value={state.allowUsage}
            onChange={next => {
              setPolicy({allowUsage: next}).catch(() => undefined);
            }}
            colors={colors}
          />
          <View
            style={[styles.divider, {backgroundColor: withAlpha(colors.outline, 0.3)}]}
          />
          <ToggleRow
            title="全屏消息"
            detail="允许主人在你屏幕上显示一句话"
            value={state.allowOverlay}
            onChange={next => {
              setPolicy({allowOverlay: next}).catch(() => undefined);
            }}
            colors={colors}
          />
        </SoftCard>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          通知转发黑名单
        </Text>
        <SoftCard radius={18} style={styles.card}>
          <View style={styles.relayRow}>
            <GlassIcon name="info" size={20} />
            <Text style={[type.caption, {color: colors.onSurfaceVariant, flex: 1}]}>
              {relayStatus?.enabled
                ? `已连接 · 待转发 ${relayStatus?.queued ?? 0} 条`
                : '未开启通知使用权'}
            </Text>
            <Pill
              text={blocklist.length > 0 ? `屏蔽 ${blocklist.length} 个` : '不屏蔽'}
              color={colors.onSurfaceVariant}
              background={colors.surfaceVariant}
            />
          </View>
          <View
            style={[
              styles.warning,
              {backgroundColor: withAlpha(colors.error, 0.1)},
            ]}>
            <Text style={[type.caption, {color: colors.error, lineHeight: 19}]}>
              当前为默认放行：除黑名单外的所有应用通知都会原样转发给主人（含验证码、金额、联系人等，不再打码）。
              不放心的话要把敏感应用加入黑名单，或关闭通知使用权。
            </Text>
          </View>
          {blocklist.length === 0 ? (
            <Text
              style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 4}]}>
              还没有屏蔽任何应用。
            </Text>
          ) : (
            blocklist.map(name => (
              <View key={name} style={styles.pkgRow}>
                <Text
                  style={[type.body, {color: colors.onSurface, flex: 1}]}
                  numberOfLines={1}>
                  {name}
                </Text>
                <Text
                  accessibilityRole="button"
                  accessibilityLabel={`移除 ${name}`}
                  onPress={() => {
                    removePackage(name).catch(() => undefined);
                  }}
                  style={[type.label, {color: colors.error}]}>
                  移除
                </Text>
              </View>
            ))
          )}
          <View style={styles.addRow}>
            <TextInput
              value={pkg}
              onChangeText={setPkg}
              placeholder="包名，如 com.tencent.mm"
              placeholderTextColor={colors.onSurfaceVariant}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="通知黑名单包名"
              style={[
                styles.input,
                {
                  color: colors.onSurface,
                  backgroundColor: colors.surfaceVariant,
                  borderColor: colors.outline,
                },
              ]}
            />
            <FlatButton
              label="屏蔽"
              onPress={() => {
                addPackage().catch(() => undefined);
              }}
              style={styles.addButton}
            />
          </View>
          <Text
            style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 10}]}>
            黑名单里的应用不会转发；其余应用默认会全部转发哦。
          </Text>
        </SoftCard>
      </ScrollView>
    </View>
  );
}

function ToggleRow({
  title,
  detail,
  value,
  onChange,
  colors,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (next: boolean) => void;
  colors: any;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{flex: 1}}>
        <Text style={[type.bodyStrong, {color: colors.onSurface}]}>{title}</Text>
        <Text style={[type.caption, {color: colors.onSurfaceVariant, marginTop: 3}]}>
          {detail}
        </Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        trackColor={{true: colors.primary, false: colors.outline}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginTop: 4, marginBottom: 8},
  sectionTitle: {marginTop: 20, marginBottom: 10},
  card: {padding: 16},
  tierRow: {flexDirection: 'row', gap: 8},
  tierButton: {flex: 1, height: 42},
  divider: {height: StyleSheet.hairlineWidth, marginVertical: 12},
  toggleRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  relayRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8},
  pkgRow: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8},
  addRow: {flexDirection: 'row', gap: 8, marginTop: 6},
  input: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  addButton: {width: 84, height: 44},
  warning: {borderRadius: 12, padding: 10, marginTop: 10},
});
