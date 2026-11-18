/**
 * 一对一绑定：选择角色 → 生成/输入绑定码 → SAS 六位码双端核对。
 *
 * SAS 是防中间人的关键：两端显示同一串数字才确认。不一致必须中止。
 */
import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {SoftCard} from '../../components/Surfaces';
import {FlatButton, TextButton} from '../../components/Ui';
import {useQi} from '../qi/QiProvider';
import {FormField} from '../qi/FormField';

type Mode = 'choose' | 'master' | 'puppy';

export function PairingScreen() {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {
    state,
    pair,
    sas,
    busy,
    error,
    createPair,
    joinPair,
    confirmSas,
    refreshPair,
    unpair,
    logout,
  } = useQi();
  const [mode, setMode] = useState<Mode>('choose');
  const [ownerName, setOwnerName] = useState('');
  const [puppyName, setPuppyName] = useState('小不点儿');
  const [code, setCode] = useState('');

  const waitingForPeer =
    mode === 'master' && !!pair && !pair.peerPubkey && !sas;

  useEffect(() => {
    if (!waitingForPeer) {
      return;
    }
    const timer = setInterval(() => {
      refreshPair().catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [waitingForPeer, refreshPair]);

  const sasPending = !!pair && !!sas && !pair.verified;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={[type.display, {color: colors.onSurface}]}>绑定</Text>
        <Text style={[type.caption, styles.account, {color: colors.onSurfaceVariant}]}>
          {state.username ? `已登录 ${state.username}` : ''}
        </Text>

        {sasPending ? (
          <SoftCard radius={20} style={styles.sasCard}>
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              请与对方核对，两端必须完全一致
            </Text>
            <Text style={[styles.sasText, {color: colors.onSurface}]}>
              {sas?.slice(0, 3)} {sas?.slice(3)}
            </Text>
            <Text style={[type.body, styles.sasHint, {color: colors.onSurfaceVariant}]}>
              一致说明配对没有被人截断。若不一致，立刻取消并检查网络。
            </Text>
            <FlatButton
              label="一致，完成绑定"
              onPress={() => {
                confirmSas().catch(() => undefined);
              }}
              disabled={busy}
              style={styles.primary}
            />
            <TextButton
              label="不一致，取消绑定"
              onPress={() => {
                unpair().catch(() => undefined);
              }}
              style={styles.secondary}
            />
          </SoftCard>
        ) : null}

        {!sasPending && waitingForPeer ? (
          <SoftCard radius={20} style={styles.sasCard}>
            <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
              把这段绑定码发给对方（10 分钟内有效）
            </Text>
            <Text style={[styles.codeText, {color: colors.primary}]}>
              {state.pendingBindingCode ?? '········'}
            </Text>
            <View style={styles.waitRow}>
              <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
                等待小狗端加入…
              </Text>
            </View>
            <TextButton
              label="取消绑定"
              onPress={() => {
                unpair().catch(() => undefined);
              }}
              style={styles.secondary}
            />
          </SoftCard>
        ) : null}

        {!sasPending && !waitingForPeer && mode === 'choose' ? (
          <>
            <Text style={[type.body, styles.hint, {color: colors.onSurfaceVariant}]}>
              一个人是主人，一个人是小狗。绑定后两端各自拥有独立的四个板块。
            </Text>
            <RoleCard
              title="我是主人"
              description="可以申请查看小狗端的屏幕时间、位置与通知，并可签发和好券。所有能力都需要对方授权。"
              onPress={() => setMode('master')}
            />
            <RoleCard
              title="我是小狗"
              description="决定授权什么、随时撤回；接收任务与券，也可以查看主人共享的状态。"
              onPress={() => setMode('puppy')}
            />
          </>
        ) : null}

        {!sasPending && !waitingForPeer && mode === 'master' ? (
          <SoftCard radius={18} style={styles.formCard}>
            <FormField label="主人的名字" value={ownerName} onChangeText={setOwnerName} placeholder="例如：我" />
            <FormField label="小狗的名字" value={puppyName} onChangeText={setPuppyName} placeholder="例如：小不点儿" />
            <FlatButton
              label="生成绑定码"
              onPress={() => {
                createPair(ownerName || '主人', puppyName || '小狗').catch(
                  () => undefined,
                );
              }}
              disabled={busy || !ownerName}
              style={styles.primary}
            />
            <TextButton label="返回" onPress={() => setMode('choose')} style={styles.secondary} />
          </SoftCard>
        ) : null}

        {!sasPending && !waitingForPeer && mode === 'puppy' ? (
          <SoftCard radius={18} style={styles.formCard}>
            <FormField
              label="绑定码"
              value={code}
              onChangeText={text => setCode(text.toUpperCase())}
              placeholder="8 位字符"
              autoCapitalize="characters"
              maxLength={8}
            />
            <FormField label="小狗的名字" value={puppyName} onChangeText={setPuppyName} />
            <FlatButton
              label="加入绑定"
              onPress={() => {
                joinPair(code, puppyName || '小狗').catch(() => undefined);
              }}
              disabled={busy || code.length !== 8}
              style={styles.primary}
            />
            <TextButton label="返回" onPress={() => setMode('choose')} style={styles.secondary} />
          </SoftCard>
        ) : null}

        {error ? (
          <Text style={[type.caption, {color: colors.error, marginTop: 14}]}>
            {error}
          </Text>
        ) : null}

        <TextButton
          label="退出登录"
          onPress={() => {
            logout().catch(() => undefined);
          }}
          style={styles.logout}
        />
      </ScrollView>
    </View>
  );
}

function RoleCard({
  title,
  description,
  onPress,
}: {
  title: string;
  description: string;
  onPress: () => void;
}) {
  const {colors} = useAppTheme();
  return (
    <SoftCard
      radius={18}
      onPress={onPress}
      accessibilityLabel={title}
      style={styles.roleCard}>
      <View style={styles.roleRow}>
        <View style={{flex: 1}}>
          <Text style={[type.section, {color: colors.onSurface}]}>{title}</Text>
          <Text style={[type.body, styles.roleText, {color: colors.onSurfaceVariant}]}>
            {description}
          </Text>
        </View>
        <GlassIcon name="chevronRight" size={20} />
      </View>
    </SoftCard>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  account: {marginTop: 6, marginBottom: 16},
  hint: {marginBottom: 14},
  roleCard: {padding: 16, marginBottom: 12},
  roleRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  roleText: {marginTop: 6},
  formCard: {paddingHorizontal: 16, paddingBottom: 18},
  sasCard: {padding: 20},
  sasText: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: '700',
    letterSpacing: 6,
    marginTop: 12,
  },
  sasHint: {marginTop: 10},
  primary: {marginTop: 20},
  secondary: {alignSelf: 'center', marginTop: 12},
  waitRow: {alignItems: 'center', marginTop: 16},
  codeText: {
    fontSize: 38,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: 8,
    marginTop: 12,
  },
  logout: {alignSelf: 'center', marginTop: 28},
});
