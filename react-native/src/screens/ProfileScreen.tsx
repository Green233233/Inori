import React, {useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {ACCENT, withAlpha} from '../theme/palette';
import {Icon} from '../components/Icon';
import {TopBar} from '../components/TopBar';
import {OutlinedButton} from '../components/Ui';
import {SoftCard} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {useJournalData} from '../data/JournalDataProvider';
import {exportBackup, importBackup, importResultMessage} from '../data/backup';

export function ProfileScreen({
  onOpenSettings,
  onOpenAbout,
}: {
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {stats, refresh} = useJournalData();
  const [busy, setBusy] = useState(false);

  const exportEntries = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await exportBackup();
      showToast('导出成功');
    } catch (error: any) {
      showToast(`导出失败: ${error?.message ?? '未知错误'}`);
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
      showToast(`导入失败: ${error?.message ?? '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const statItems = [
    {
      icon: 'edit_note',
      label: '日记',
      value: String(stats.total),
      tint: '#FFFFFF',
      fg: colors.onPrimary,
      background: colors.primary,
    },
    {
      icon: 'local_fire_department',
      label: '连续',
      value: `${stats.streak}天`,
      tint: '#FFFFFF',
      fg: '#FFFFFF',
      background: ACCENT.fireOrange,
    },
    {
      icon: 'star',
      label: '收藏',
      value: String(stats.favorite),
      tint: '#4A3503',
      fg: '#4A3503',
      background: ACCENT.starYellow,
    },
  ];

  return (
    <View style={styles.root}>
      <TopBar title="个人中心" />
      <ScrollView
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingBottom: 32,
        }}>
        <View style={styles.hero}>
          <SoftCard
            radius={tokens.avatarSize / 2}
            backgroundColor={colors.primaryContainer}
            style={[
              styles.avatar,
              {
                width: tokens.avatarSize,
                height: tokens.avatarSize,
              },
            ]}>
            <Icon
              name="account_circle"
              size={tokens.avatarIconSize}
              color={colors.onPrimaryContainer}
            />
          </SoftCard>
          <Text
            style={[
              styles.name,
              {fontSize: tokens.profileNameSize, color: colors.onSurface},
            ]}>
            日记爱好者
          </Text>
          <Text
            style={[styles.tagline, {color: colors.onSurfaceVariant}]}>
            记录生活中的每一个美好瞬间
          </Text>
        </View>

        <View
          style={[
            styles.statsRow,
            {marginTop: tokens.sectionGap, gap: tokens.listSpacing},
          ]}>
          {statItems.map(item => (
            <SoftCard
              key={item.label}
              radius={16}
              backgroundColor={item.background}
              style={styles.statBlock}>
              <Icon name={item.icon} size={22} color={item.tint} />
              <Text
                style={[
                  styles.statValue,
                  {
                    fontSize: tokens.statValueSize,
                    color: item.fg,
                  },
                ]}>
                {item.value}
              </Text>
              <Text
                style={[
                  styles.statLabel,
                  {color: item.fg, opacity: 0.88},
                ]}>
                {item.label}
              </Text>
            </SoftCard>
          ))}
        </View>

        <View
          style={{
            marginTop: tokens.sectionGap,
            flexDirection: tokens.isCompact ? 'column' : 'row',
            gap: 12,
          }}>
          <OutlinedButton
            label="导出条目"
            icon="cloud_upload"
            onPress={exportEntries}
            style={styles.actionButton}
          />
          <OutlinedButton
            label="导入条目"
            icon="cloud_download"
            onPress={importEntries}
            style={styles.actionButton}
          />
        </View>

        <SoftCard
          radius={16}
          style={[
            styles.menuCard,
            {
              marginTop: tokens.isNarrow ? 16 : 24,
            },
          ]}>
          <MenuRow
            icon="settings"
            label="设置"
            onPress={onOpenSettings}
            color={colors.primary}
            textColor={colors.onSurface}
            divider={withAlpha(colors.outline, 0.25)}
          />
          <MenuRow
            icon="cloud_upload"
            label="数据备份"
            onPress={exportEntries}
            color={colors.primary}
            textColor={colors.onSurface}
            divider={withAlpha(colors.outline, 0.25)}
          />
          <MenuRow
            icon="info"
            label="关于"
            onPress={onOpenAbout}
            color={colors.primary}
            textColor={colors.onSurface}
            last
          />
        </SoftCard>
      </ScrollView>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  color,
  textColor,
  divider,
  last,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  color: string;
  textColor: string;
  divider?: string;
  last?: boolean;
}) {
  const {colors} = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.menuRow,
        pressed && {backgroundColor: withAlpha(colors.primary, 0.06)},
        !last && divider
          ? {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: divider}
          : null,
      ]}>
      <Icon name={icon} size={22} color={color} />
      <Text style={[styles.menuText, {color: textColor}]}>{label}</Text>
      <Icon name="chevron_right" size={20} color={colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  hero: {alignItems: 'center', paddingTop: 12},
  avatar: {alignItems: 'center', justifyContent: 'center'},
  name: {fontWeight: '700', marginTop: 10},
  tagline: {fontSize: 14, marginTop: 4, textAlign: 'center'},
  statsRow: {flexDirection: 'row'},
  statBlock: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 12,
    gap: 3,
  },
  statValue: {fontWeight: '700', marginTop: 1},
  statLabel: {fontSize: 12},
  actionButton: {flex: 1},
  menuCard: {borderRadius: 14, overflow: 'hidden'},
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  menuText: {flex: 1, fontSize: 16},
});
