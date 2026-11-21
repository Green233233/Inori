import React, {useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {type} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {JournalCard} from '../components/JournalCard';
import {TopBar} from '../components/TopBar';
import {AppDialog, TextButton} from '../components/Ui';
import {StaggerReveal} from '../motion/StaggerReveal';
import {useJournalData} from '../data/JournalDataProvider';
import {deleteEntry, setFavorite} from '../data/storage';
import {EntrySummary} from '../data/types';

export function FavoritesScreen({
  onOpenEntry,
  onNewEntry,
}: {
  onOpenEntry: (id: string) => void;
  onNewEntry?: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const {favorites, loading, refresh} = useJournalData();
  const [deleteTarget, setDeleteTarget] = useState<EntrySummary | null>(null);

  return (
    <View style={styles.root}>
      <TopBar title="收藏" titleSize={28} />
      {favorites.length === 0 && !loading ? (
        <View style={styles.emptyWrap}>
          <View
            style={[
              styles.iconBubble,
              {backgroundColor: withAlpha('#FF375F', 0.18)},
            ]}>
            <GlassIcon name="favorite" size={42} />
          </View>
          <Text style={[type.headline, {color: colors.onSurface}]}>
            还没有收藏哦
          </Text>
          <Text
            style={[
              type.body,
              styles.emptyText,
              {color: colors.onSurfaceVariant},
            ]}>
            可以收藏你喜欢的日记哦
          </Text>
          {onNewEntry ? <TextButton label="写一篇" onPress={onNewEntry} /> : null}
        </View>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={item => item.id}
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
      <AppDialog
        visible={deleteTarget !== null}
        title="删除日记"
        message={
          deleteTarget
            ? `确定要删除「${deleteTarget.title}」吗？此操作不可撤销！`
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
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  iconBubble: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyText: {textAlign: 'center'},
});
