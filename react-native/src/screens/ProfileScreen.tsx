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
import {OutlinedButton} from '../components/Ui';
import {ColorField, SoftCard} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {useReducedMotion} from '../motion/useReducedMotion';
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
          把日子过成一本好看的书
        </Text>

        <ColorField
          color={colors.primary}
          radius={22}
          style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={styles.avatar}>
              <GlassIcon name="profile" size={46} tone="onAccent" />
            </View>
            <View style={{flex: 1}}>
              <Text style={[styles.name, {color: onAccentFor(colors.primary)}]}>
                日记爱好者
              </Text>
              <Text
                style={[
                  type.caption,
                  {color: withAlpha(onAccentFor(colors.primary), 0.78)},
                ]}>
                记录生活中的每一个美好瞬间
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
          更多
        </Text>
        <SoftCard radius={18} style={styles.menuCard}>
          <MenuRow
            icon="settings"
            label="设置"
            onPress={onOpenSettings}
            divider={withAlpha(colors.outline, 0.25)}
          />
          <MenuRow
            icon="cloudUpload"
            label="数据备份"
            onPress={exportEntries}
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
