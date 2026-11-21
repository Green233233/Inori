import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../theme/AppThemeProvider';
import {onAccentFor} from '../theme/palette';
import {USE_NATIVE_DRIVER, spring} from '../theme/motion';
import {type} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {GlassIconName} from '../components/glass-icons.generated';
import {GlassSurface} from '../components/Surfaces';
import {showToast} from '../components/toast';
import {QiHomeScreen} from '../features/home/QiHomeScreen';
import {JournalTab} from '../features/journal/JournalTab';
import CouponManagement from '../features/coupons/CouponManagement';
import CouponWallet from '../features/coupons/CouponWallet';
import type {Coupon} from '../data/pairTypes';
import {useQi} from '../features/qi/QiProvider';
import {ProfileScreen} from './ProfileScreen';
import {Category} from '../data/types';

export type MainTabKey = 'home' | 'coupons' | 'journal' | 'profile';

const TABS: {key: MainTabKey; label: string; icon: GlassIconName}[] = [
  {key: 'home', label: '主页', icon: 'home'},
  {key: 'coupons', label: '和好券', icon: 'star'},
  {key: 'journal', label: '日记', icon: 'book'},
  {key: 'profile', label: '我的', icon: 'profile'},
];

export function MainTabs({
  activeTab,
  onTabChange,
  onOpenEntry,
  onNewEntry,
  onOpenCategory,
  onOpenSettings,
  onOpenAbout,
  onOpenQi,
  onOpenPermissionCenter,
  onOpenControlCenter,
  onOpenAuthorizationStatus,
  onOpenCoupon,
  onRedeemCoupon,
  onOpenResponseConfig,
  onOpenAutoRules,
  onOpenAppearance,
  onOpenSharedSpace,
  onOpenPartnerLocation,
  onOpenTasks,
  onOpenTrail,
  onOpenReminders,
  onOpenAlbum,
  onOpenNotifications,
  onOpenJournalSettings,
}: {
  activeTab: MainTabKey;
  onTabChange: (tab: MainTabKey) => void;
  onOpenEntry: (id: string) => void;
  onNewEntry: () => void;
  onOpenCategory: (category: Category) => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onOpenQi: () => void;
  onOpenPermissionCenter: () => void;
  onOpenControlCenter: () => void;
  onOpenAuthorizationStatus: () => void;
  onOpenCoupon: (coupon: Coupon) => void;
  onRedeemCoupon: (coupon: Coupon) => void;
  onOpenResponseConfig: () => void;
  onOpenAutoRules: () => void;
  onOpenAppearance: () => void;
  onOpenSharedSpace: () => void;
  onOpenPartnerLocation: () => void;
  onOpenTasks: () => void;
  onOpenTrail: () => void;
  onOpenReminders: () => void;
  onOpenAlbum: () => void;
  onOpenNotifications: () => void;
  onOpenJournalSettings: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const {role} = useQi();
  const dockWidth = width - 24;
  const tabWidth = dockWidth / TABS.length;
  const activeIndex = Math.max(
    0,
    TABS.findIndex(tab => tab.key === activeTab),
  );
  const indicator = useRef(new Animated.Value(activeIndex)).current;

  useEffect(() => {
    Animated.spring(indicator, {
      toValue: activeIndex,
      ...spring.pop,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [activeIndex, indicator]);

  const activeColor = colors.primary;
  const activeOn = onAccentFor(activeColor);

  return (
    <View style={styles.root}>
      <View style={[styles.content, {paddingBottom: 72 + insets.bottom}]}>
        {activeTab === 'home' ? (
          <QiHomeScreen
            onOpenJournal={() => onTabChange('journal')}
            onOpenCoupons={() => onTabChange('coupons')}
            onOpenProfile={() => onTabChange('profile')}
            onOpenControlCenter={onOpenControlCenter}
            onOpenAuthorizationStatus={onOpenAuthorizationStatus}
            onOpenPermissionCenter={onOpenPermissionCenter}
            onOpenSharedSpace={onOpenSharedSpace}
            onOpenPartnerLocation={onOpenPartnerLocation}
            onOpenTasks={onOpenTasks}
            onOpenTrail={onOpenTrail}
            onOpenReminders={onOpenReminders}
            onOpenAlbum={onOpenAlbum}
            onOpenNotifications={onOpenNotifications}
          />
        ) : null}
        {activeTab === 'coupons' ? (
          <View
            style={{
              flex: 1,
              paddingTop: 6,
            }}>
            {role === 'MASTER' ? (
              <CouponManagement onRedeem={onRedeemCoupon} />
            ) : (
              <CouponWallet
                onAskMaster={() => showToast('可以和主人说一声了哦')}
                onOpenCoupon={onOpenCoupon}
              />
            )}
          </View>
        ) : null}
        {activeTab === 'journal' ? (
          <JournalTab
            onOpenEntry={onOpenEntry}
            onNewEntry={onNewEntry}
            onOpenCategory={onOpenCategory}
            onOpenSettings={onOpenJournalSettings}
          />
        ) : null}
        {activeTab === 'profile' ? (
          <ProfileScreen
            onOpenSettings={onOpenSettings}
            onOpenAbout={onOpenAbout}
            onOpenQi={onOpenQi}
            onOpenPermissionCenter={onOpenPermissionCenter}
            onOpenResponseConfig={
              role === 'PUPPY' ? onOpenResponseConfig : undefined
            }
            onOpenAutoRules={role === 'PUPPY' ? onOpenAutoRules : undefined}
            onOpenAppearance={role === 'PUPPY' ? onOpenAppearance : undefined}
          />
        ) : null}
      </View>

      <View
        pointerEvents="box-none"
        style={[styles.dockWrap, {bottom: insets.bottom + 8}]}>
        <GlassSurface radius={28} strong elevation={12} style={styles.dock}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              {
                width: tabWidth - 8,
                backgroundColor: activeColor,
                transform: [
                  {
                    translateX: indicator.interpolate({
                      inputRange: [0, TABS.length - 1],
                      outputRange: [4, dockWidth - tabWidth + 4],
                    }),
                  },
                ],
              },
            ]}
          />
          {TABS.map(tab => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{selected: active}}
                accessibilityLabel={tab.label}
                onPress={() => onTabChange(tab.key)}
                style={styles.tab}>
                <GlassIcon
                  name={tab.icon}
                  size={22}
                  tone={active ? 'onAccent' : 'auto'}
                />
                <Text
                  style={[
                    styles.label,
                    {
                      fontSize: tokens.navLabelSize,
                      color: active ? activeOn : colors.onSurfaceVariant,
                    },
                  ]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </GlassSurface>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {flex: 1},
  dockWrap: {position: 'absolute', left: 12, right: 12},
  dock: {height: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4},
  indicator: {position: 'absolute', left: 0, top: 6, bottom: 6, borderRadius: 22},
  tab: {flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', gap: 2},
  label: {...type.label},
});
