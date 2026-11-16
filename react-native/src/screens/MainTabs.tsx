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
import {HomeScreen} from './HomeScreen';
import {CategoryScreen} from './CategoryScreen';
import {FavoritesScreen} from './FavoritesScreen';
import {ProfileScreen} from './ProfileScreen';
import {Category} from '../data/types';

export type MainTabKey = 'home' | 'category' | 'favorites' | 'profile';

const TABS: {key: MainTabKey; label: string; icon: GlassIconName}[] = [
  {key: 'home', label: '首页', icon: 'home'},
  {key: 'category', label: '分类', icon: 'category'},
  {key: 'favorites', label: '收藏', icon: 'favorite'},
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
}: {
  activeTab: MainTabKey;
  onTabChange: (tab: MainTabKey) => void;
  onOpenEntry: (id: string) => void;
  onNewEntry: () => void;
  onOpenCategory: (category: Category) => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
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
          <HomeScreen
            onOpenEntry={onOpenEntry}
            onNewEntry={onNewEntry}
            onOpenCategory={onOpenCategory}
          />
        ) : null}
        {activeTab === 'category' ? (
          <CategoryScreen onOpenCategory={onOpenCategory} />
        ) : null}
        {activeTab === 'favorites' ? (
          <FavoritesScreen
            onOpenEntry={onOpenEntry}
            onNewEntry={onNewEntry}
          />
        ) : null}
        {activeTab === 'profile' ? (
          <ProfileScreen
            onOpenSettings={onOpenSettings}
            onOpenAbout={onOpenAbout}
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
  dockWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
  },
  dock: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    borderRadius: 22,
  },
  tab: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {...type.label},
});
