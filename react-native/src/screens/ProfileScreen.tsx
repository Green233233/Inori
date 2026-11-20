import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {onAccentFor, withAlpha} from '../theme/palette';
import {type, tabularNums} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {GlassIconName} from '../components/glass-icons.generated';
import {OutlinedButton, Pill} from '../components/Ui';
import {RoleAvatar} from '../components/RoleAvatar';
import {ColorField, SoftCard} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {useReducedMotion} from '../motion/useReducedMotion';
import {useJournalData} from '../data/JournalDataProvider';
import {exportBackup, importBackup, importResultMessage} from '../data/backup';
import {useQi} from '../features/qi/QiProvider';

export function ProfileScreen({
  onOpenSettings,
  onOpenAbout,
  onOpenQi,
  onOpenPermissionCenter,
  onOpenResponseConfig,
  onOpenAutoRules,
  onOpenAppearance,
}: {
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onOpenQi?: () => void;
  onOpenPermissionCenter?: () => void;
  onOpenResponseConfig?: () => void;
  onOpenAutoRules?: () => void;
  onOpenAppearance?: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {stats, refresh} = useJournalData();
  const {role, state, openSetup} = useQi();
  const heroColor = role === 'PUPPY' ? colors.secondary : colors.primary;
  const roleLabel =
    role === 'MASTER' ? '主人端' : role === 'PUPPY' ? '小狗端' : '未联结';
  const displayName =
    state.displayName ||
    state.username ||
    (role === 'MASTER' ? '主人' : role === 'PUPPY' ? '小狗' : '还没有联结呢');
  const avatarUri = state.avatarImagePath
    ? state.avatarImagePath.startsWith('file://')
      ? state.avatarImagePath
      : `file://${state.avatarImagePath}`
    : null;
  const avatarStyle =
    state.avatarStyle === 'photo' && !avatarUri ? 'role' : state.avatarStyle;
  const [busy, setBusy] = useState(false);

  const exportEntries = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await exportBackup();
      showToast('导出成功啦');
    } catch (error: any) {
      showToast(`导出失败QAQ: ${error?.message ?? '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const importEntries = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await importBackup({overwrite: false});
      showToast(importResultMessage(result), true);
      await refresh();
    } catch (error: any) {
      showToast(`导入失败QAQ: ${error?.message ?? '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const statsItems = [
    {
      icon: 'edit' as GlassIconName,
      label: '篇日记',
      value: stats.total,
      background: colors.primary,
      on: onAccentFor(colors.primary),
    },
    {
      icon: 'flame' as GlassIconName,
      label: '天连续',
      value: stats.streak,
      background: '#32D7FF',
      on: onAccentFor('#32D7FF'),
    },
    {
      icon: 'favorite' as GlassIconName,
      label: '个收藏',
      value: stats.favorite,
      background: '#C6FF3D',
      on: onAccentFor('#C6FF3D'),
    },
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingTop: 8,
          paddingBottom: 36,
        }}
        showsVerticalScrollIndicator={false}>
        <Text style={[type.display, {color: colors.onSurface}]}>我的</Text>
        <Text style={[type.body, {color: colors.onSurfaceVariant, marginTop: 4}]}>
          {roleLabel} · 小狗与主人天生一对永远不分开！
        </Text>

        <ColorField color={heroColor} radius={22} style={styles.hero}>
          <View style={styles.heroRow}>
            <RoleAvatar
              role={role}
              name={displayName}
              size={76}
              avatarStyle={avatarStyle}
              imageUri={avatarUri}
              ringColor={
                state.appearance.frame === 'default'
                  ? withAlpha(onAccentFor(heroColor), 0.55)
                  : withAlpha(
                      state.appearance.frame === 'rose'
                        ? '#FF5C8A'
                        : state.appearance.frame === 'mint'
                          ? '#31D0AA'
                          : '#F2B544',
                      0.9,
                    )
              }
              onColor={onAccentFor(heroColor)}
            />
            <View style={{flex: 1}}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, {color: onAccentFor(heroColor)}]}>
                  {displayName}
                </Text>
                <Pill
                  text={roleLabel}
                  color={onAccentFor(heroColor)}
                  background={withAlpha(onAccentFor(heroColor), 0.18)}
                />
              </View>
              <Text
                style={[
                  type.caption,
                  {color: withAlpha(onAccentFor(heroColor), 0.8)},
                ]}>
                {state.pair
                  ? `${state.pair.ownerName} 与 ${state.pair.puppyName} · ${
                      state.pair.verified ? '绑定已校验' : '待校验'
                    }`
                  : '还没有联结哦 · 可以在「我的身份与联结」里完成绑定'}
              </Text>
            </View>
          </View>
        </ColorField>

        <View style={[styles.statsRow, {marginTop: 12}]}>
          {statsItems.map(item => (
            <SoftCard
              key={item.label}
              radius={16}
              backgroundColor={item.background}
              style={styles.statBlock}>
              <GlassIcon
                name={item.icon}
                size={22}
                tone={item.on === '#FFFFFF' ? 'light' : 'dark'}
              />
              <CountUp
                value={item.value}
                color={item.on}
                style={styles.statValue}
              />
              <Text style={[type.caption, {color: item.on, opacity: 0.78}]}>
                {item.label}
              </Text>
            </SoftCard>
          ))}
        </View>

        <View style={styles.actionsRow}>
          <OutlinedButton
            label="导出条目"
            icon="cloudUpload"
            onPress={exportEntries}
            style={styles.actionButton}
            textColor={colors.onSurface}
          />
          <OutlinedButton
            label="导入条目"
            icon="cloudDownload"
            onPress={importEntries}
            style={styles.actionButton}
            textColor={colors.onSurface}
          />
        </View>

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          联结
        </Text>
        <SoftCard radius={18} style={styles.menuCard}>
          {onOpenQi ? (
            <MenuRow
              icon="favorite"
              label="我的身份与联结"
              onPress={onOpenQi}
              divider={withAlpha(colors.outline, 0.25)}
            />
          ) : null}
          <MenuRow
            icon="profile"
            label="头像与昵称"
            onPress={onOpenSettings}
            divider={onOpenAppearance ? withAlpha(colors.outline, 0.25) : undefined}
            last={!onOpenAppearance && !onOpenQi}
          />
          {onOpenAppearance ? (
            <MenuRow
              icon="moodHappy"
              label="装扮"
              onPress={onOpenAppearance}
              divider={state.journalOnly ? withAlpha(colors.outline, 0.25) : undefined}
              last={!state.journalOnly}
            />
          ) : null}
          {state.journalOnly ? (
            <MenuRow
              icon="info"
              label="登录 / 联结"
              onPress={() => {
                openSetup().catch(() => undefined);
              }}
              last
            />
          ) : null}
        </SoftCard>

        {onOpenPermissionCenter ? (
          <>
            <Text
              style={[
                type.section,
                styles.sectionTitle,
                {color: colors.onSurface},
              ]}>
              隐私与权限
            </Text>
            <SoftCard radius={18} style={styles.menuCard}>
              <MenuRow
                icon="info"
                label="权限管控中心"
                onPress={onOpenPermissionCenter}
                divider={withAlpha(colors.outline, 0.25)}
              />
              {onOpenResponseConfig ? (
                <MenuRow
                  icon="settings"
                  label="响应配置"
                  onPress={onOpenResponseConfig}
                  divider={onOpenAutoRules ? withAlpha(colors.outline, 0.25) : undefined}
                  last={!onOpenAutoRules}
                />
              ) : null}
              {onOpenAutoRules ? (
                <MenuRow
                  icon="weatherNight"
                  label="自动规则"
                  onPress={onOpenAutoRules}
                  last
                />
              ) : null}
            </SoftCard>
          </>
        ) : null}

        <Text style={[type.section, styles.sectionTitle, {color: colors.onSurface}]}>
          应用
        </Text>
        <SoftCard radius={18} style={styles.menuCard}>
          <MenuRow
            icon="settings"
            label="设置"
            onPress={onOpenSettings}
            divider={withAlpha(colors.outline, 0.25)}
          />
          <MenuRow icon="info" label="关于" onPress={onOpenAbout} last />
        </SoftCard>
      </ScrollView>
    </View>
  );
}

function CountUp({
  value,
  color,
  style,
}: {
  value: number;
  color: string;
  style?: any;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const anim = useRef(new Animated.Value(reduced ? value : 0)).current;

  useEffect(() => {
    if (reduced) {
      setShown(value);
      anim.setValue(value);
      return;
    }
    const sub = anim.addListener(({value: next}) => setShown(Math.round(next)));
    Animated.timing(anim, {
      toValue: value,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => {
      anim.removeListener(sub);
      anim.stopAnimation();
    };
  }, [anim, reduced, value]);

  return (
    <Text style={[type.title, tabularNums, {color}, style]}>{shown}</Text>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  divider,
  last,
}: {
  icon: GlassIconName;
  label: string;
  onPress: () => void;
  divider?: string;
  last?: boolean;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({pressed}) => [
        styles.menuRow,
        pressed && {backgroundColor: withAlpha(colors.primary, 0.08)},
        !last && divider
          ? {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: divider,
            }
          : null,
      ]}>
      <GlassIcon name={icon} size={26} />
      <Text style={[styles.menuText, {color: colors.onSurface}]}>{label}</Text>
      <GlassIcon name="chevronRight" size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  hero: {marginTop: 20, padding: 18, minHeight: 136, justifyContent: 'center'},
  heroRow: {flexDirection: 'row', alignItems: 'center', gap: 14},
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {fontSize: 22, fontWeight: '800', letterSpacing: -0.3},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap'},
  statsRow: {flexDirection: 'row', gap: 10},
  statBlock: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 4,
    alignItems: 'flex-start',
  },
  statValue: {fontWeight: '800'},
  actionsRow: {flexDirection: 'row', gap: 10, marginTop: 20},
  actionButton: {flex: 1},
  sectionTitle: {marginTop: 28, marginBottom: 10},
  menuCard: {overflow: 'hidden'},
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  menuText: {flex: 1, fontSize: 16, fontWeight: '600'},
});
