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
import {isPairCodeComplete, normalizePairCode} from './pairCode';

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
  const [pollMisses, setPollMisses] = useState(0);

  // 未校验的双方都要轮询：主人等对方加入，小狗等对方（主人）回到这一页确认。
  // 原来只在「主人 + 还没人加入」时轮询，导致小狗端加入后主人确认完，
  // 小狗端界面永远停在「等待校验」，只能杀进程重进。
  const needPoll = !!pair && !pair.verified;

  // 已经有未校验的配对（比如杀进程重进、或对方刚加入）时，直接落到自己的角色页，
  // 否则会停在「你是主人还是小狗」的选择页，让人以为配对丢了。
  const pairRole = pair?.myRole;
  useEffect(() => {
    if (!pair || pair.verified || !pairRole) {
      return;
    }
    setMode(current =>
      current === 'choose' ? (pairRole === 'MASTER' ? 'master' : 'puppy') : current,
    );
  }, [pair, pairRole]);

  const pollOnce = React.useCallback(async () => {
    const next = await refreshPair();
    setPollMisses(count => (next ? 0 : count + 1));
    return next;
  }, [refreshPair]);

  useEffect(() => {
    if (!needPoll) {
      setPollMisses(0);
      return;
    }
    let alive = true;
    const timer = setInterval(() => {
      refreshPair()
        .then(next => {
          if (!alive) {
            return;
          }
          setPollMisses(count => (next ? 0 : count + 1));
        })
        .catch(() => {
          if (alive) {
            setPollMisses(count => count + 1);
          }
        });
    }, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [needPoll, refreshPair]);

  const waitingForPeer =
    mode === 'master' && !!pair && !pair.peerPubkey && !sas;

  const sasPending = !!pair && !!sas && !pair.verified;

  // 已经加入（有对方公钥）却还没有 SAS：可能是本地算码失败，或者刷新前
  // 还没拿到配对详情。给一个明确的「正在核对」态 + 手动刷新，别留白屏。
  const sasMissing = !!pair && !!pair.peerPubkey && !pair.verified && !sas;

  const pollStalled = needPoll && pollMisses >= 3;

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
                {pollStalled ? '暂时没连上服务器，正在重试…' : '等待小狗端加入…'}
              </Text>
            </View>
            <TextButton
              label="刷新状态"
              onPress={() => {
                pollOnce().catch(() => undefined);
              }}
              style={styles.secondary}
            />
            <TextButton
              label="取消绑定"
              onPress={() => {
                unpair().catch(() => undefined);
              }}
              style={styles.secondary}
            />
          </SoftCard>
        ) : null}

        {!sasPending && !waitingForPeer && sasMissing ? (
          <SoftCard radius={20} style={styles.sasCard}>
            <Text style={[type.section, {color: colors.onSurface}]}>
              正在核对安全校验码…
            </Text>
            <Text style={[type.body, styles.sasHint, {color: colors.onSurfaceVariant}]}>
              双方已经连上，正在本地算出六位校验码。
              {pollStalled
                ? '目前没连上服务器，可以先点下面的「刷新状态」。'
                : '如果一直停在这里，点一下「刷新状态」。'}
            </Text>
            <FlatButton
              label="刷新状态"
              onPress={() => {
                pollOnce().catch(() => undefined);
              }}
              disabled={busy}
              style={styles.primary}
            />
            <TextButton
              label="退出重来"
              onPress={() => {
                unpair().catch(() => undefined);
              }}
              style={styles.secondary}
            />
          </SoftCard>
        ) : null}

        {!sasPending && !waitingForPeer && !sasMissing && mode === 'choose' ? (
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
            <TextButton
              label="已经绑定过？刷新绑定状态"
              onPress={() => {
                pollOnce().catch(() => undefined);
              }}
              style={styles.secondary}
            />
          </>
        ) : null}

        {!sasPending && !waitingForPeer && !sasMissing && mode === 'master' ? (
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

        {!sasPending && !waitingForPeer && !sasMissing && mode === 'puppy' ? (
          <SoftCard radius={18} style={styles.formCard}>
            <FormField
              label="绑定码"
              value={code}
              onChangeText={text => setCode(normalizePairCode(text))}
              placeholder="8 位字符"
              autoCapitalize="characters"
              maxLength={8}
              hint="从主人那边复制过来即可，空格和短横线会自动去掉"
            />
            <FormField label="小狗的名字" value={puppyName} onChangeText={setPuppyName} />
            <FlatButton
              label="加入绑定"
              onPress={() => {
                joinPair(normalizePairCode(code), puppyName || '小狗').catch(
                  () => undefined,
                );
              }}
              disabled={busy || !isPairCodeComplete(code)}
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
