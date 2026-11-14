import React, {useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {Icon} from '../components/Icon';
import {JournalCard} from '../components/JournalCard';
import {TopBar} from '../components/TopBar';
import {AppDialog} from '../components/Ui';
import {useJournalData} from '../data/JournalDataProvider';
import {deleteEntry, setFavorite} from '../data/storage';
import {EntrySummary} from '../data/types';

export function FavoritesScreen({
  onOpenEntry,
}: {
  onOpenEntry: (id: string) => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {favorites, loading, refresh} = useJournalData();
  const [deleteTarget, setDeleteTarget] = useState<EntrySummary | null>(null);

  return (
    <View style={styles.root}>
      <TopBar title="收藏" />
      {favorites.length === 0 && !loading ? (
        <View style={styles.emptyWrap}>
          <Icon
            name="favorite_border"
            size={tokens.emptyIconSize}
            color={withAlpha(colors.onSurfaceVariant, 0.5)}
          />
          <Text
            style={[
              styles.emptyText,
              {
                color: colors.onSurfaceVariant,
                fontSize: tokens.isNarrow ? 14 : 16,
              },
            ]}>
            收藏的日记将显示在这里
          </Text>
        </View>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            padding: tokens.contentPadding,
            paddingTop: 12,
            paddingBottom: 24,
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
  emptyWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24},
  emptyText: {textAlign: 'center'},
});
