import React, {useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {JournalCard} from '../components/JournalCard';
import {AppDialog} from '../components/Ui';
import {TopBar} from '../components/TopBar';
import {useJournalData} from '../data/JournalDataProvider';
import {deleteEntry, setFavorite} from '../data/storage';
import {CATEGORY_LABEL, Category, EntrySummary} from '../data/types';

export function CategoryEntriesScreen({
  category,
  onBack,
  onOpenEntry,
}: {
  category: Category;
  onBack: () => void;
  onOpenEntry: (id: string) => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {entries, loading, refresh} = useJournalData();
  const [deleteTarget, setDeleteTarget] = useState<EntrySummary | null>(null);

  const visible = useMemo(() => {
    if (category === 'ALL') {
      return entries;
    }
    return entries.filter(item => item.category === category);
  }, [entries, category]);

  return (
    <View style={styles.root}>
      <TopBar title={CATEGORY_LABEL[category]} onBack={onBack} />
      {visible.length === 0 && !loading ? (
        <View style={styles.emptyWrap}>
          <Text style={{color: colors.onSurfaceVariant}}>
            该分类下暂无日记
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
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
  emptyWrap: {flex: 1, alignItems: 'center', justifyContent: 'center'},
});
