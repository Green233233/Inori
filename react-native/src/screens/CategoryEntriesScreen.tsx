import React, {useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {CATEGORY_ACCENT, onAccentFor} from '../theme/palette';
import {type} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {GlassIconName} from '../components/glass-icons.generated';
import {JournalCard} from '../components/JournalCard';
import {TextButton, AppDialog} from '../components/Ui';
import {TopBar} from '../components/TopBar';
import {StaggerReveal} from '../motion/StaggerReveal';
import {useJournalData} from '../data/JournalDataProvider';
import {deleteEntry, setFavorite} from '../data/storage';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  Category,
  EntrySummary,
} from '../data/types';

export function CategoryEntriesScreen({
  category,
  onBack,
  onOpenEntry,
  onNewEntry,
}: {
  category: Category;
  onBack: () => void;
  onOpenEntry: (id: string) => void;
  onNewEntry?: () => void;
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
  const accent = CATEGORY_ACCENT[category] ?? colors.primary;

  return (
    <View style={styles.root}>
      <TopBar title={CATEGORY_LABEL[category]} onBack={onBack} titleSize={28} />
      {visible.length === 0 && !loading ? (
        <View style={styles.emptyWrap}>
          <View style={[styles.iconBubble, {backgroundColor: accent}]}>
            <GlassIcon
              name={CATEGORY_ICON[category] as GlassIconName}
              size={38}
              tone={onAccentFor(accent) === '#FFFFFF' ? 'light' : 'dark'}
            />
          </View>
          <Text style={[type.headline, {color: colors.onSurface}]}>
            这里还是空的
          </Text>
          <Text style={[type.body, styles.emptyBody, {color: colors.onSurfaceVariant}]}>
            在这个分类下写下第一篇日记吧。
          </Text>
          {onNewEntry ? <TextButton label="写一篇" onPress={onNewEntry} /> : null}
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            padding: tokens.contentPadding,
            paddingTop: 8,
            paddingBottom: 32,
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
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  iconBubble: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyBody: {textAlign: 'center'},
});
