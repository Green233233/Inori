import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {Icon} from '../components/Icon';
import {GlassSurface} from '../components/Surfaces';
import {HomeScreen} from './HomeScreen';
import {CategoryScreen} from './CategoryScreen';
import {FavoritesScreen} from './FavoritesScreen';
import {ProfileScreen} from './ProfileScreen';
import {Category} from '../data/types';

export type MainTabKey = 'home' | 'category' | 'favorites' | 'profile';

const TABS: {key: MainTabKey; label: string; icon: string}[] = [
  {key: 'home', label: '首页', icon: 'home'},
  {key: 'category', label: '分类', icon: 'dashboard'},
  {key: 'favorites', label: '收藏', icon: 'favorite'},
  {key: 'profile', label: '我的', icon: 'person'},
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

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {activeTab === 'home' ? (
          <HomeScreen onOpenEntry={onOpenEntry} onNewEntry={onNewEntry} />
        ) : null}
        {activeTab === 'category' ? (
          <CategoryScreen onOpenCategory={onOpenCategory} />
        ) : null}
        {activeTab === 'favorites' ? (
          <FavoritesScreen onOpenEntry={onOpenEntry} />
        ) : null}
        {activeTab === 'profile' ? (
          <ProfileScreen
            onOpenSettings={onOpenSettings}
            onOpenAbout={onOpenAbout}
          />
        ) : null}
      </View>

      <GlassSurface
        radius={0}
        elevation={6}
        style={[
          styles.navBar,
          {
            paddingBottom: insets.bottom,
            borderLeftWidth: 0,
            borderRightWidth: 0,
            borderBottomWidth: 0,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: withAlpha(colors.outline, 0.24),
          },
        ]}>
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
              <View
                style={[
                  styles.iconPill,
                  active && {
                    backgroundColor: withAlpha(colors.primary, 0.12),
                    borderTopWidth: 1,
                    borderTopColor: withAlpha('#FFFFFF', 0.6),
                  },
                ]}>
                <Icon
                  name={tab.icon}
                  size={23}
                  color={active ? colors.primary : colors.onSurfaceVariant}
                />
              </View>
              <Text
                style={{
                  fontSize: tokens.navLabelSize,
                  marginTop: 2,
                  color: active ? colors.primary : colors.onSurfaceVariant,
                  fontWeight: active ? '600' : '400',
                }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {flex: 1},
  navBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
  },
  tab: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 4},
  iconPill: {
    width: 54,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
