import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {
  CATEGORY_ACCENT,
  onAccentFor,
  withAlpha,
} from '../theme/palette';
import {type, tabularNums} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {GlassIconName} from '../components/glass-icons.generated';
import {JournalCard} from '../components/JournalCard';
import {AppDialog, RoundIconButton, TextButton} from '../components/Ui';
import {ColorField, SoftCard} from '../components/Surfaces';
import {HomeSkeleton} from '../components/Skeleton';
import {StaggerReveal} from '../motion/StaggerReveal';
import {useJournalData} from '../data/JournalDataProvider';
import {filterByQuery, deleteEntry, setFavorite} from '../data/storage';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  Category,
  EntrySummary,
  todayIso,
} from '../data/types';

export function HomeScreen({
  onOpenEntry,
  onNewEntry,
  onOpenCategory,
}: {
  onOpenEntry: (id: string) => void;
  onNewEntry: () => void;
  onOpenCategory: (category: Category) => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {entries, loading, refresh} = useJournalData();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EntrySummary | null>(null);

  const visible = useMemo(
    () => filterByQuery(entries, searching ? query : ''),
    [entries, query, searching],
  );
  const today = useMemo(
    () => entries.find(entry => entry.date === todayIso()),
    [entries],
  );
  const now = new Date();
  const dateText = `${now.getMonth() + 1}月${now.getDate()}日 · 周${
    '日一二三四五六'[now.getDay()]
  }`;

  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.topRow}>
        <Text style={[styles.brand, {color: colors.onSurface}]}>祈</Text>
        <View style={styles.actions}>
          <RoundIconButton
            name={searching ? 'close' : 'search'}
            accessibilityLabel={searching ? '关闭搜索' : '搜索'}
            onPress={() => (searching ? closeSearch() : setSearching(true))}
          />
          <RoundIconButton
            name="add"
            accessibilityLabel="新建日记"
            tone="onAccent"
            style={{backgroundColor: colors.primary, borderColor: colors.primary}}
            onPress={onNewEntry}
          />
        </View>
      </View>

      {searching ? (
        <SearchReveal>
          <SoftCard sunken radius={999} style={styles.searchBox}>
            <GlassIcon name="search" size={18} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoFocus
              multiline={false}
              placeholder="搜索日记"
              placeholderTextColor={colors.onSurfaceVariant}
              style={[styles.searchInput, {color: colors.onSurface}]}
            />
          </SoftCard>
        </SearchReveal>
      ) : (
        <>
          <Text style={[type.display, styles.display, {color: colors.onSurface}]}>
            今天
          </Text>
          <Text style={[type.caption, {color: colors.onSurfaceVariant}]}>
            {dateText}
          </Text>
        </>
      )}

      {!searching ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}>
          {CATEGORY_ORDER.map(category => {
            const accent = CATEGORY_ACCENT[category] ?? colors.primary;
            const icon = CATEGORY_ICON[category] as GlassIconName;
            return (
              <Pressable
                key={category}
                accessibilityRole="button"
                accessibilityLabel={CATEGORY_LABEL[category]}
                onPress={() => onOpenCategory(category)}
                style={({pressed}) => [
                  styles.railChip,
                  {
                    backgroundColor: accent,
                    borderColor: withAlpha(accent, pressed ? 0.7 : 0.9),
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <GlassIcon
                  name={icon}
                  size={17}
                  tone={onAccentFor(accent) === '#FFFFFF' ? 'light' : 'dark'}
                />
                <Text
                  style={[
                    styles.railText,
                    {color: onAccentFor(accent)},
                  ]}>
                  {CATEGORY_LABEL[category]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {!searching ? (
        <ColorField
          color={today ? colors.primary : colors.secondary}
          radius={20}
          style={styles.hero}>
          <View style={styles.heroBody}>
            <Text
              style={[
                type.label,
                {color: 'rgba(255,255,255,0.78)', letterSpacing: 0.6},
              ]}>
              {today ? '今天的这一页' : '今天还没有写下什么'}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.heroTitle, {color: onAccentFor(today ? colors.primary : colors.secondary)}]}>
              {today?.title?.trim() || (today ? '未命名日记' : '记录今天')}
            </Text>
            <Text
              numberOfLines={2}
              style={[
                type.body,
                {
                  color: withAlpha(
                    onAccentFor(today ? colors.primary : colors.secondary),
                    0.8,
                  ),
                },
              ]}>
              {today
                ? today.preview?.trim() || '今天的心情，还在等你补完。'
                : '一句话、一张照片，都算今天。'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={today ? '打开今天的日记' : '记录今天'}
            onPress={() => (today ? onOpenEntry(today.id) : onNewEntry())}
            hitSlop={10}
            style={styles.heroAction}>
            <Text style={[type.label, {color: onAccentFor(today ? colors.primary : colors.secondary)}]}>
              {today ? '继续写' : '开始'}
            </Text>
            <GlassIcon
              name="chevronRight"
              size={18}
              tone="onAccent"
            />
          </Pressable>
        </ColorField>
      ) : null}

      <View style={styles.sectionRow}>
        <Text style={[type.section, {color: colors.onSurface}]}>
          {searching ? '搜索结果' : '最近'}
        </Text>
        <Text style={[type.caption, tabularNums, {color: colors.onSurfaceVariant}]}>
          {visible.length} 篇
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      {loading && visible.length === 0 ? (
        <View style={{padding: tokens.contentPadding}}>
          {header}
          <HomeSkeleton />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={item => item.id}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View
                style={[
                  styles.emptyIcon,
                  {backgroundColor: withAlpha(colors.primary, 0.14)},
                ]}>
                <GlassIcon
                  name={searching ? 'search' : 'book'}
                  size={38}
                />
              </View>
              <Text style={[type.headline, styles.emptyTitle, {color: colors.onSurface}]}>
                {searching ? '没有找到相关日记' : '还没有日记'}
              </Text>
              <Text
                style={[
                  type.body,
                  styles.emptyBody,
                  {color: colors.onSurfaceVariant},
                ]}>
                {searching ? '换个关键词试试。' : '把今天的第一句话留在这里。'}
              </Text>
              {!searching ? (
                <TextButton label="写第一篇" onPress={onNewEntry} />
              ) : null}
            </View>
          }
          contentContainerStyle={{
            padding: tokens.contentPadding,
            paddingTop: 8,
            paddingBottom: 96,
            gap: tokens.listSpacing,
          }}
          renderItem={({item, index}) => (
            <StaggerReveal index={index}>
              <JournalCard
                entry={item}
                onPress={() => onOpenEntry(item.id)}
                onFavorite={() => {
                  setFavorite(item.id, !item.isFavorite).then(refresh);
                }}
                onDelete={() => setDeleteTarget(item)}
              />
            </StaggerReveal>
          )}
        />
      )}

      <SoftCard
        accessibilityRole="button"
        accessibilityLabel="新建日记"
        onPress={onNewEntry}
        radius={28}
        backgroundColor={colors.primary}
        style={[styles.fab, {right: tokens.contentPadding + 4}]}>
        <GlassIcon name="add" size={28} tone="onAccent" />
      </SoftCard>

      <AppDialog
        visible={deleteTarget !== null}
        title="删除日记"
        message={
          deleteTarget
            ? `确定要删除「${deleteTarget.title}」吗？此操作不可撤销。`
            : ''
        }
        confirmLabel="删除"
        destructive
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) {
            deleteEntry(target.id).then(refresh);
          }
        }}
        dismissLabel="取消"
        onDismiss={() => setDeleteTarget(null)}
      />
    </View>
  );
}

function SearchReveal({children}: {children: React.ReactNode}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [progress]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [-6, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  headerWrap: {paddingTop: 0, paddingBottom: 6},
  topRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {fontSize: 22, fontWeight: '800', letterSpacing: -0.5},
  actions: {flexDirection: 'row', gap: 8},
  display: {marginTop: 10},
  searchBox: {
    marginTop: 8,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  searchInput: {...type.body, flex: 1, padding: 0, margin: 0},
  rail: {gap: 8, paddingTop: 16, paddingBottom: 4},
  railChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  railText: {...type.label, fontSize: 12},
  hero: {
    marginTop: 16,
    minHeight: 148,
    padding: 18,
    justifyContent: 'space-between',
  },
  heroBody: {gap: 6},
  heroTitle: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  heroAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    marginTop: 8,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 10,
  },
  emptyWrap: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {marginTop: 16},
  emptyBody: {marginTop: 6, marginBottom: 12, textAlign: 'center'},
  fab: {
    position: 'absolute',
    bottom: 18,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
