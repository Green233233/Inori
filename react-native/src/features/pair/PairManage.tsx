/**
 * 联结管理：查看当前绑定关系、重新校验、解绑或退出登录。
 *
 * 「解绑」是双端同时生效的破坏性操作：需要二次确认，并在成功后清掉本地密钥与
 * 服务器上的配对密文。
 */
import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {ColorField, SoftCard} from '../../components/Surfaces';
import {AppDialog, FlatButton, TextButton} from '../../components/Ui';
import {TopBar} from '../../components/TopBar';
import {showToast} from '../../components/toast';
import {useQi} from '../qi/QiProvider';
import {RoleAvatar} from '../../components/RoleAvatar';

export function PairManage({onBack}: {onBack: () => void}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {pair, role, state, unpair, logout, refreshPair} = useQi();
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const isMaster = role === 'MASTER';
  const heroColor = isMaster ? colors.primary : colors.secondary;

  return (
    <View style={styles.root}>
      <TopBar title="我的身份与联结" onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: insets.bottom + 40,
        }}
        showsVerticalScrollIndicator={false}>
        <ColorField color={heroColor} radius={22} style={styles.hero}>
          <View style={styles.heroRow}>
            <RoleAvatar
              role={role}
              name={state.displayName || state.username || undefined}
              size={64}
              avatarStyle={state.avatarStyle}
              imageUri={
                state.avatarImagePath ? `file://${state.avatarImagePath}` : null
              }
              ringColor={withAlpha('#FFFFFF', 0.6)}
              onColor="#FFFFFF"
            />
            <View style={{flex: 1}}>
              <Text style={styles.heroName}>{state.displayName || state.username}</Text>
              <Text style={[type.caption, styles.heroSub]}>
                {isMaster ? '主人端' : '小狗端'} ·{' '}
                {pair?.verified ? '绑定已校验' : '待校验'}
              </Text>
            </View>
          </View>
        </ColorField>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          绑定关系
        </Text>
        <SoftCard radius={18} style={styles.card}>
          <Row
            label="主人"
            value={pair ? pair.ownerName : '—'}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            label="小狗"
            value={pair ? pair.puppyName : '—'}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            label="状态"
            value={
              pair
                ? pair.verified
                  ? `已校验 · ${pair.peerOnline ? '对方在线' : '对方离线'}`
                  : '等待对方确认'
                : '尚未绑定'
            }
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            label="绑定时间"
            value={
              pair?.createdAt
                ? new Date(pair.createdAt).toLocaleString('zh-CN')
                : '—'
            }
            colors={colors}
          />
        </SoftCard>

        {pair?.peerDeviceMissing ? (
          <SoftCard radius={16} style={[styles.card, styles.warnCard]}>
            <Text style={[type.bodyStrong, {color: colors.error}]}>
              对方设备已注销
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, lineHeight: 19, marginTop: 6},
              ]}>
              对方换了手机或清掉了应用数据，这台设备上的绑定已经失效。建议解除绑定后重新走一次配对。
            </Text>
          </SoftCard>
        ) : null}

        <Text
          style={[
            type.caption,
            {color: colors.onSurfaceVariant, lineHeight: 19},
          ]}>
          端到端加密：服务器只保存密文；解绑后配对密文会被删除。
        </Text>

        <FlatButton
          label="刷新状态"
          onPress={() => {
            refreshPair().catch(() => undefined);
          }}
          style={styles.secondary}
          backgroundColor={colors.surfaceVariant}
          textColor={colors.onSurface}
        />
        <TextButton
          label="解除绑定"
          color={colors.error}
          onPress={() => setConfirmUnpair(true)}
          style={styles.danger}
        />
        <TextButton
          label="退出登录"
          color={colors.onSurfaceVariant}
          onPress={() => setConfirmLogout(true)}
          style={styles.logout}
        />
      </ScrollView>

      <AppDialog
        visible={confirmUnpair}
        title="解除绑定？"
        message="解绑后双方都看不到共享日记、券与共享空间，服务器上的配对密文会被删除。"
        confirmLabel="解除"
        dismissLabel="再想想"
        destructive
        onDismiss={() => setConfirmUnpair(false)}
        onConfirm={() => {
          setConfirmUnpair(false);
          unpair()
            .then(({alreadyUnpaired}) =>
              showToast(alreadyUnpaired ? '对方已经解绑了，本地也已清理' : '已解除绑定'),
            )
            .catch((error: any) => showToast(error?.message ?? '解绑失败'));
        }}
      />

      <AppDialog
        visible={confirmLogout}
        title="退出登录？"
        message="退出后需要重新登录；已绑定关系会保留，除非你主动解绑。"
        confirmLabel="退出"
        dismissLabel="取消"
        onDismiss={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          logout()
            .then(onBack)
            .catch((error: any) => showToast(error?.message ?? '退出失败'));
        }}
      />
    </View>
  );
}

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: any;
}) {
  return (
    <View style={styles.row}>
      <Text style={[type.body, {color: colors.onSurfaceVariant}]}>{label}</Text>
      <Text style={[type.bodyStrong, {color: colors.onSurface, flex: 1}]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Divider({colors}: {colors: any}) {
  return (
    <View style={[styles.divider, {backgroundColor: withAlpha(colors.outline, 0.3)}]} />
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  hero: {padding: 18, marginTop: 4},
  heroRow: {flexDirection: 'row', alignItems: 'center', gap: 14},
  heroName: {fontSize: 22, fontWeight: '800', color: '#FFFFFF'},
  heroSub: {color: 'rgba(255,255,255,0.85)', marginTop: 4},
  sectionTitle: {marginTop: 22, marginBottom: 10},
  card: {paddingHorizontal: 16, paddingVertical: 4, marginBottom: 14},
  warnCard: {paddingVertical: 14, marginTop: -4},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
  },
  divider: {height: StyleSheet.hairlineWidth},
  secondary: {marginTop: 10, height: 46},
  danger: {alignSelf: 'center', marginTop: 18},
  logout: {alignSelf: 'center', marginTop: 6},
});
