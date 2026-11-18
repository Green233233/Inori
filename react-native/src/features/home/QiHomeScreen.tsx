/**
 * 主页：联结状态 + 两端各自的入口。
 *
 * 设备管控 / 数据查看等画面在后续步骤接入；这里只呈现「已经真的能用」的东西，
 * 不放假按钮。
 */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {onAccentFor, withAlpha} from '../../theme/palette';
import {type} from '../../theme/typography';
import {GlassIcon} from '../../components/GlassIcon';
import {ColorField, SoftCard} from '../../components/Surfaces';
import {FlatButton, Pill} from '../../components/Ui';
import {showToast} from '../../components/toast';
import {PERMISSION_KEYS, qiDevicePermissions} from '../../native/QiDevice';
import {useQi} from '../qi/QiProvider';

export function QiHomeScreen({
  onOpenJournal,
  onOpenCoupons,
  onOpenControlCenter,
  onOpenAuthorizationStatus,
  onOpenSharedSpace,
  onOpenTasks,
  onOpenReminders,
  onOpenAlbum,
  onOpenNotifications,
}: {
  onOpenJournal: () => void;
  onOpenCoupons: () => void;
  onOpenProfile?: () => void;
  onOpenControlCenter: () => void;
  onOpenAuthorizationStatus: () => void;
  onOpenPermissionCenter?: () => void;
  onOpenSharedSpace: () => void;
  onOpenTasks: () => void;
  onOpenReminders: () => void;
  onOpenAlbum: () => void;
  onOpenNotifications: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {pair, role, state, lastSyncAt} = useQi();
  const isMaster = role === 'MASTER';
  const bound = !!pair;
  const roleLabel = isMaster ? '主人端' : role === 'PUPPY' ? '小狗端' : '未联结';
  const partnerName = isMaster ? pair?.puppyName : pair?.ownerName;
  const myName = isMaster ? pair?.ownerName : pair?.puppyName;
  const accent = isMaster ? colors.primary : colors.secondary;
  const onAccent = onAccentFor(accent);

  /**
   * 小狗端「打开权限中心」直接跳系统设置里本应用的权限页：
   * 用户说的是「去系统里开权限」，在应用内再点十次「去设置」反而绕。
   * 应用内的权限清单仍在「我的 → 权限管控中心」。
   */
  const openSystemPermissions = React.useCallback(() => {
    qiDevicePermissions
      .openAppSettings()
      .then((opened) =>
        opened
          ? true
          : qiDevicePermissions.openSettingsFor([...PERMISSION_KEYS]),
      )
      .catch((error: any) => {
        showToast(error?.message ?? '打不开系统设置，请到「我的 → 权限管控中心」逐项开启');
      });
  }, []);

  const lastSync = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '尚未同步';

  return (
    <ScrollView
      contentContainerStyle={{
        padding: tokens.contentPadding,
        paddingTop: 12,
        paddingBottom: 36,
      }}
      showsVerticalScrollIndicator={false}>
      <Text style={[type.display, {color: colors.onSurface}]}>祈</Text>
      <Text style={[type.body, {color: colors.onSurfaceVariant, marginTop: 4}]}>
        {roleLabel}
        {bound
          ? ` · ${myName || state.username || '你'}`
          : ' · 先在「我的 → 我的身份与联结」里完成绑定'}
      </Text>

      <ColorField color={accent} radius={22} style={styles.hero}>
        <View style={styles.heroRow}>
          <View
            style={[
              styles.dot,
              {backgroundColor: pair?.peerOnline ? '#28CD41' : onAccent},
            ]}
          />
          <Text style={[type.caption, {color: withAlpha(onAccent, 0.86)}]}>
            {pair?.peerOnline ? '在线' : '离线'}
            {typeof pair?.peerBattery === 'number'
              ? ` · 电量 ${pair.peerBattery}%`
              : ''}
          </Text>
        </View>
        <Text style={[styles.heroName, {color: onAccent}]}>
          {partnerName || '对方'}
        </Text>
        <Text style={[type.caption, {color: withAlpha(onAccent, 0.8)}]}>
          {isMaster ? '小狗端' : '主人端'} · 校验
          {pair?.verified ? '已完成' : '待确认'} · 最近同步 {lastSync}
        </Text>
        {!isMaster && state.appearance.greeting ? (
          <Text style={[type.bodyStrong, {color: onAccent, marginTop: 10}]}>
            {state.appearance.greeting}
          </Text>
        ) : null}
      </ColorField>

      <View style={styles.actions}>
        <FlatButton
          label="和好券"
          icon="favorite"
          onPress={onOpenCoupons}
          style={styles.action}
        />
        <FlatButton
          label="日记"
          icon="edit"
          onPress={onOpenJournal}
          style={styles.action}
          backgroundColor={colors.surfaceVariant}
          textColor={colors.onSurface}
        />
      </View>

      <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
        {isMaster ? '管控与查看' : '我的权限'}
      </Text>
      {isMaster ? (
        <SoftCard
          radius={18}
          onPress={onOpenControlCenter}
          accessibilityLabel="打开设备管控中心"
          style={styles.card}>
          <View style={styles.cardRow}>
            <GlassIcon name="settings" size={26} />
            <View style={{flex: 1}}>
              <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
                设备管控中心
              </Text>
              <Text
                style={[
                  type.caption,
                  {color: colors.onSurfaceVariant, marginTop: 4},
                ]}>
                屏幕、使用时长、定位、通知与全屏消息
              </Text>
            </View>
            <GlassIcon name="chevronRight" size={20} />
          </View>
        </SoftCard>
      ) : null}

      <SoftCard
        radius={18}
        onPress={isMaster ? onOpenAuthorizationStatus : openSystemPermissions}
        accessibilityLabel={isMaster ? '打开授权状态' : '打开权限中心'}
        style={styles.card}>
        <View style={styles.cardRow}>
          <GlassIcon name={isMaster ? 'settings' : 'info'} size={26} />
          <View style={{flex: 1}}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              {isMaster ? '查看授权状态' : '打开权限中心'}
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 4},
              ]}>
              {isMaster
                ? '小狗端的每一项权限都由它自己授予；撤回会立刻反映到这里。'
                : '授权什么、什么时候撤回，永远由你决定。'}
            </Text>
          </View>
          <GlassIcon name="chevronRight" size={20} />
        </View>
      </SoftCard>

      <SoftCard
        radius={18}
        onPress={onOpenSharedSpace}
        accessibilityLabel="打开共享空间"
        style={styles.card}>
        <View style={styles.cardRow}>
          <GlassIcon name="star" size={26} />
          <View style={{flex: 1}}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              共享空间
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 4},
              ]}>
              只属于你们两个人的便签与里程碑
            </Text>
          </View>
          <GlassIcon name="chevronRight" size={20} />
        </View>
      </SoftCard>

      <SoftCard
        radius={18}
        onPress={onOpenTasks}
        accessibilityLabel={isMaster ? '打开任务与指令' : '打开我的任务'}
        style={styles.card}>
        <View style={styles.cardRow}>
          <GlassIcon name="check" size={26} />
          <View style={{flex: 1}}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              {isMaster ? '任务与指令' : '我的任务'}
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 4},
              ]}>
              {isMaster ? '下任务、看报备、验收' : '查看任务并提交报备'}
            </Text>
          </View>
          <GlassIcon name="chevronRight" size={20} />
        </View>
      </SoftCard>

      <SoftCard
        radius={18}
        onPress={onOpenReminders}
        accessibilityLabel="打开定时规则"
        style={styles.card}>
        <View style={styles.cardRow}>
          <GlassIcon name="refresh" size={26} />
          <View style={{flex: 1}}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              定时规则
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 4},
              ]}>
              到点提醒，例如每天 22:30 睡觉
            </Text>
          </View>
          <GlassIcon name="chevronRight" size={20} />
        </View>
      </SoftCard>

      <SoftCard
        radius={18}
        onPress={onOpenAlbum}
        accessibilityLabel="打开相册分享"
        style={styles.card}>
        <View style={styles.cardRow}>
          <GlassIcon name="photo" size={26} />
          <View style={{flex: 1}}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              相册分享
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 4},
              ]}>
              照片加密上传，只有你们两个人能看
            </Text>
          </View>
          <GlassIcon name="chevronRight" size={20} />
        </View>
      </SoftCard>

      <SoftCard
        radius={18}
        onPress={onOpenNotifications}
        accessibilityLabel="打开通知转发"
        style={styles.card}>
        <View style={styles.cardRow}>
          <GlassIcon name="info" size={26} />
          <View style={{flex: 1}}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              通知转发
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 4},
              ]}>
              {isMaster ? '拉取小狗端转发的通知摘要' : '管理通知黑名单与开关'}
            </Text>
          </View>
          <GlassIcon name="chevronRight" size={20} />
        </View>
      </SoftCard>

      <SoftCard radius={18} style={styles.card}>
        <View style={styles.cardRow}>
          <GlassIcon name="info" size={26} />
          <View style={{flex: 1}}>
            <Text style={[type.bodyStrong, {color: colors.onSurface}]}>
              屏幕查看规则
            </Text>
            <Text
              style={[
                type.caption,
                {color: colors.onSurfaceVariant, marginTop: 4},
              ]}>
              Android 13 及以下：开启「随时查看屏幕」后，主人查看只会通知你；Android
              14 及以上：每次都需要你确认。
            </Text>
          </View>
        </View>
      </SoftCard>

      <View style={styles.pills}>
        <Pill
          text={pair?.verified ? '绑定已校验' : '待校验'}
          color={colors.onSurfaceVariant}
          background={colors.surfaceVariant}
        />
        <Pill
          text={
            state.powerTier === 'SAVER'
              ? '省电'
              : state.powerTier === 'REALTIME'
                ? '实时'
                : '智能'
          }
          color={colors.onSurfaceVariant}
          background={colors.surfaceVariant}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {marginTop: 20, padding: 20, minHeight: 150, justifyContent: 'center'},
  heroRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  dot: {width: 8, height: 8, borderRadius: 4},
  heroName: {fontSize: 26, lineHeight: 32, fontWeight: '700', marginTop: 10},
  actions: {flexDirection: 'row', gap: 10, marginTop: 16},
  action: {flex: 1},
  sectionTitle: {marginTop: 26, marginBottom: 10},
  card: {padding: 16, marginBottom: 12},
  cardRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  pills: {flexDirection: 'row', gap: 8, marginTop: 6},
});
