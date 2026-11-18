/**
 * 日记板块：把原有的「首页 / 分类 / 收藏」收进同一板块的分段里。
 * 不改动原有三屏的交互，只提供分段外壳。
 */
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {GlassIcon} from '../../components/GlassIcon';
import {useAppTheme} from '../../theme/AppThemeProvider';
import {type} from '../../theme/typography';
import {HomeScreen} from '../../screens/HomeScreen';
import {CategoryScreen} from '../../screens/CategoryScreen';
import {FavoritesScreen} from '../../screens/FavoritesScreen';
import {Category} from '../../data/types';
import {useQi} from '../qi/QiProvider';

type Segment = 'all' | 'category' | 'favorite';

const SEGMENTS: {key: Segment; label: string}[] = [
  {key: 'all', label: '全部'},
  {key: 'category', label: '分类'},
  {key: 'favorite', label: '收藏'},
];

export function JournalTab({
  onOpenEntry,
  onNewEntry,
  onOpenCategory,
  onOpenSettings,
}: {
  onOpenEntry: (id: string) => void;
  onNewEntry: () => void;
  onOpenCategory: (category: Category) => void;
  onOpenSettings: () => void;
}) {
  const {colors} = useAppTheme();
  const {pair} = useQi();
  const [segment, setSegment] = useState<Segment>('all');

  return (
    <View style={styles.root}>
      <View style={styles.segmentWrap}>
        <View
          style={[styles.segmentTrack, {backgroundColor: colors.surfaceVariant}]}>
          {SEGMENTS.map(item => {
            const active = item.key === segment;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{selected: active}}
                accessibilityLabel={item.label}
                onPress={() => setSegment(item.key)}
                style={[
                  styles.segment,
                  active && {backgroundColor: colors.surface},
                ]}>
                <Text
                  style={[
                    type.label,
                    {
                      color: active ? colors.onSurface : colors.onSurfaceVariant,
                    },
                  ]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="日记设置"
          onPress={onOpenSettings}
          style={[styles.gear, {backgroundColor: colors.surface}]}>
          <GlassIcon name="settings" size={18} />
        </Pressable>
        {pair ? (
          <Text
            style={[
              type.caption,
              styles.sharedHint,
              {color: colors.onSurfaceVariant},
            ]}>
            {pair.puppyName} 与 {pair.ownerName} 的共享日记会标上 TA
          </Text>
        ) : null}
      </View>

      <View style={styles.content}>
        {segment === 'all' ? (
          <HomeScreen
            onOpenEntry={onOpenEntry}
            onNewEntry={onNewEntry}
            onOpenCategory={onOpenCategory}
          />
        ) : null}
        {segment === 'category' ? (
          <CategoryScreen onOpenCategory={onOpenCategory} />
        ) : null}
        {segment === 'favorite' ? (
          <FavoritesScreen onOpenEntry={onOpenEntry} onNewEntry={onNewEntry} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  segmentWrap: {paddingHorizontal: 12, paddingTop: 6},
  gear: {
    position: 'absolute',
    right: 12,
    top: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTrack: {flexDirection: 'row', borderRadius: 999, padding: 3},
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharedHint: {marginTop: 8, marginLeft: 4},
  content: {flex: 1},
});
