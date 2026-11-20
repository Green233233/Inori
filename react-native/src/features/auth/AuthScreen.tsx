/**
 * 登录 / 注册 + 自建服务器设置。
 *
 * 视觉与主界面一致：同一条页面 gutter、实色卡片 + separator、单一强调色；
 * 输入框用比卡片低一档的中性面，保证浅色/深色都可读。
 */
import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {FlatButton, TextButton} from '../../components/Ui';
import {useQi} from '../qi/QiProvider';
import {FormField} from '../qi/FormField';

type Mode = 'login' | 'register';

export function AuthScreen() {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {
    state,
    busy,
    error,
    clearError,
    configureServer,
    login,
    register,
    chooseJournalOnly,
  } = useQi();
  const [mode, setMode] = useState<Mode>('login');
  const [serverOpen, setServerOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState(state.serverUrl);
  const [pin, setPin] = useState(state.pin);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [invite, setInvite] = useState('');
  const [localError, setLocalError] = useState('');

  const submitLabel = useMemo(
    () => (mode === 'login' ? '登录' : '创建账号'),
    [mode],
  );
  const serverLabel = useMemo(() => {
    try {
      const url = new URL(serverUrl);
      return `${url.hostname}${url.port ? `:${url.port}` : ''}`;
    } catch {
      return serverUrl || '未设置';
    }
  }, [serverUrl]);

  const trimmedInvite = invite.trim();
  // 邀请码和绑定码是同一套 8 位字母表（服务端 security.random_pair_code()），
  // 长度不对就一定是打错了；8 位但服务端查不到，会由服务端回 invited_* 的
  // 具体原因（是绑定码 / 需要邀请码 / 已被使用）。
  // 注册要输两遍密码：打错一位就再也登录不上，而账号名会被永久占用。
  const passwordMismatch =
    mode === 'register' && passwordAgain.length > 0 && password !== passwordAgain;

  const inviteWrongLength =
    mode === 'register' &&
    trimmedInvite.length > 0 &&
    trimmedInvite.length !== 8;

  const submit = () => {
    // 上一轮的错误（尤其是「这个账号已经存在」）如果不清掉，用户改完字段
    // 再点一次会以为自己又失败了。
    clearError();
    setLocalError('');
    if (passwordMismatch) {
      setLocalError('两次输入的密码不一样，再对一遍呀');
      return;
    }
    if (inviteWrongLength) {
      setLocalError('邀请码是 8 位字符。如果你手上是绑定码，请先用账号登录，再在「绑定」页填写');
      return;
    }
    const task = async () => {
      const normalized = serverUrl.trim().replace(/\/+$/, '');
      if (normalized !== state.serverUrl || pin.trim() !== state.pin) {
        await configureServer(normalized, pin);
      }
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password, invite);
      }
    };
    task().catch(() => undefined);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    clearError();
    setLocalError('');
    setPasswordAgain('');
  };
  const shownError = localError || error;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingTop: insets.top + 28,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={[type.display, {color: colors.onSurface}]}>联结</Text>
        <Text style={[type.body, styles.intro, {color: colors.onSurfaceVariant}]}>
          一对一绑定。账号与密文存在你自己的服务器，日记只是其中一页。
        </Text>

        <View style={[styles.serverRow, {borderColor: colors.outline}]}>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            服务器 · {serverLabel}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={serverOpen ? '收起服务器设置' : '展开服务器设置'}
            hitSlop={8}
            onPress={() => setServerOpen(value => !value)}>
            <Text style={[type.label, {color: colors.primary}]}>
              {serverOpen ? '收起' : '设置'}
            </Text>
          </Pressable>
        </View>

        {serverOpen ? (
          <View
            style={[
              styles.card,
              {backgroundColor: colors.surface, borderColor: colors.outline},
            ]}>
            <FormField
              label="服务器地址"
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://你的服务器:8443"
              keyboardType="url"
              hint="模拟器访问本机用 http://10.0.2.2:8095"
            />
            <FormField
              label="证书指纹（可选）"
              value={pin}
              onChangeText={setPin}
              placeholder="SHA-256 十六进制"
              hint="使用自签名证书时建议填写；留空则用系统信任"
            />
          </View>
        ) : null}

        <View style={[styles.segment, {backgroundColor: colors.surfaceVariant}]}>
          {(['login', 'register'] as Mode[]).map(item => {
            const active = mode === item;
            return (
              <Pressable
                key={item}
                accessibilityRole="tab"
                accessibilityState={{selected: active}}
                accessibilityLabel={item === 'login' ? '登录' : '注册'}
                onPress={() => switchMode(item)}
                style={[
                  styles.segmentItem,
                  active && {
                    backgroundColor: colors.surface,
                    borderColor: withAlpha(colors.outline, 0.6),
                  },
                ]}>
                <Text
                  style={[
                    type.label,
                    {
                      color: active ? colors.onSurface : colors.onSurfaceVariant,
                    },
                  ]}>
                  {item === 'login' ? '登录' : '注册'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View
          style={[
            styles.card,
            {backgroundColor: colors.surface, borderColor: colors.outline},
          ]}>
          <FormField
            label="账号"
            value={username}
            onChangeText={value => {
              setUsername(value);
              clearError();
              setLocalError('');
            }}
            placeholder="小写字母 / 数字 / 下划线"
            autoCapitalize="none"
          />
          <FormField
            label="密码"
            value={password}
            onChangeText={value => {
              setPassword(value);
              clearError();
              setLocalError('');
            }}
            placeholder="至少 8 位，含字母与数字"
            secureTextEntry
          />
          {mode === 'register' ? (
            <FormField
              label="确认密码"
              value={passwordAgain}
              onChangeText={value => {
                setPasswordAgain(value);
                clearError();
                setLocalError('');
              }}
              placeholder="再输一遍刚才的密码"
              secureTextEntry
              hint={
                passwordMismatch
                  ? '两次输入不一样哦'
                  : '打错一位就登录不上了，所以这里再确认一遍'
              }
            />
          ) : null}
          {mode === 'register' ? (
            <FormField
              label="邀请码（第一个账号可留空）"
              value={invite}
              onChangeText={value => {
                setInvite(value);
                clearError();
                setLocalError('');
              }}
              placeholder="服务器签发的 8 位邀请码"
              autoCapitalize="characters"
              maxLength={8}
              hint="绑定码不要填在这里：绑定码是登录后到「绑定」页用的。第一个账号不需要邀请码，之后由服务器主人生成，或让主人开启开放注册"
            />
          ) : null}
        </View>

        {mode === 'login' ? (
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            邀请码只用于注册新账号；已经有账号就直接用账号和密码登录，换手机也一样。
          </Text>
        ) : null}

        {shownError ? (
          <View
            style={[
              styles.errorBox,
              {backgroundColor: withAlpha(colors.error, 0.12)},
            ]}>
            <Text style={[type.caption, {color: colors.error}]}>
              {shownError}
            </Text>
          </View>
        ) : null}

        <FlatButton
          label={submitLabel}
          onPress={submit}
          disabled={
            busy ||
            !username ||
            !password ||
            passwordMismatch ||
            (mode === 'register' && passwordAgain.length === 0) ||
            inviteWrongLength
          }
          style={styles.primary}
        />
        <TextButton
          label="仅使用日记（不联结）"
          onPress={() => {
            chooseJournalOnly().catch(() => undefined);
          }}
          color={colors.onSurfaceVariant}
          style={styles.secondary}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  intro: {marginTop: 8, marginBottom: 18},
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 3,
    marginBottom: 14,
  },
  segmentItem: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 2,
    marginBottom: 14,
  },
  errorBox: {borderRadius: 12, padding: 12, marginBottom: 4},
  primary: {marginTop: 10, height: 48},
  secondary: {alignSelf: 'center', marginTop: 16},
});
