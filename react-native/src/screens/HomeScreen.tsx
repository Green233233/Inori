import React, {useMemo, useState} from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {Icon} from '../components/Icon';
import {JournalCard} from '../components/JournalCard';
import {AppDialog} from '../components/Ui';
import {GlassSurface, SoftCard} from '../components/Surfaces';
import {useJournalData} from '../data/JournalDataProvider';
import {filterByQuery, deleteEntry, setFavorite} from '../data/storage';
import {EntrySummary} from '../data/types';

export function HomeScreen({
  onOpenEntry,
  onNewEntry,
}: {
  onOpenEntry: (id: string) => void;
  onNewEntry: () => void;
}) {
  const {colors, surfaces, tokens} = useAppTheme();
  const {entries, loading, refresh} = useJournalData();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EntrySummary | null>(null);

  const visible = useMemo(
    () => filterByQuery(entries, searching ? query : ''),
    [entries, query, searching],
  );

  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };

  return (
    <View style={styles.root}>
      <GlassSurface
        radius={0}
        elevation={0}
        style={{
          borderTopWidth: 0,
          borderLeftWidth: 0,
          borderRightWidth: 0,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: surfaces.shadowSoft,
        }}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={searching ? '关闭搜索' : '搜索'}
            focusable={false}
            hitSlop={8}
            onPress={() => (searching ? closeSearch() : setSearching(true))}
            style={styles.headerIcon}>
            <Icon
              name={searching ? 'close' : 'search'}
              size={23}
              color={colors.onSurface}
            />
          </Pressable>
          {searching ? (
            <View
              style={[
                styles.searchField,
                {
                  backgroundColor: surfaces.sunken,
                  borderTopColor: surfaces.shadowSoft,
                  borderBottomColor: surfaces.highlight,
                },
              ]}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoFocus
                multiline={false}
                placeholder="搜索日记"
                placeholderTextColor={colors.onSurfaceVariant}
                style={[styles.searchInput, {color: colors.onSurface}]}
              />
            </View>
          ) : (
            <Text
              style={[
                styles.brand,
                {fontSize: tokens.brandTitleSize, color: colors.onSurface},
              ]}>
              祈
            </Text>
          )}
          <View style={styles.headerIcon}>
            {!searching ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="新建日记"
                focusable={false}
                hitSlop={8}
                onPress={onNewEntry}>
                <Icon name="add" size={25} color={colors.onSurface} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </GlassSurface>

      {visible.length === 0 && !loading ? (
        <View style={styles.emptyWrap}>
          <Icon
            name={searching ? 'search' : 'edit_note'}
            size={tokens.emptyIconSize}
            color={withAlpha(colors.onSurfaceVariant, 0.45)}
          />
          <Text style={[styles.emptyText, {color: colors.onSurfaceVariant}]}>
            {searching ? '没有找到相关日记' : '还没有日记，开始记录吧'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            padding: tokens.contentPadding,
            paddingBottom: tokens.fabBottomInset,
            gap: tokens.listSpacing,
          }}
          renderItem={({item}) => (
            <JournalCard
              entry={item}
              onPress={() => onOpenEntry(item.id)}
              onFavorite={() => {
                setFavorite(item.id, !item.isFavorite).then(refresh);
              }}
              onDelete={() => setDeleteTarget(item)}
            />
          )}
        />
      )}

      <SoftCard
        accessibilityRole="button"
        accessibilityLabel="新建日记"
        onPress={onNewEntry}
        radius={18}
        backgroundColor={colors.primary}
        style={[
          styles.fab,
          {
            right: tokens.contentPadding + 4,
            bottom: 20,
          },
        ]}>
        <Icon name="add" size={30} color={colors.onPrimary} />
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

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  headerIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {flex: 1, textAlign: 'center', fontWeight: '700'},
  searchField: {
    flex: 1,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    height: 40,
    marginHorizontal: 2,
    justifyContent: 'center',
  },
  searchInput: {fontSize: 14, padding: 0, margin: 0},
  emptyWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24},
  emptyText: {marginTop: 14, fontSize: 15, textAlign: 'center'},
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
