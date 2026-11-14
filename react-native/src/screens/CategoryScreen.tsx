import React from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {CATEGORY_ACCENT} from '../theme/palette';
import {Icon} from '../components/Icon';
import {TopBar} from '../components/TopBar';
import {SoftCard} from '../components/Surfaces';
import {useJournalData} from '../data/JournalDataProvider';
import {categoriesCount} from '../data/storage';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  Category,
} from '../data/types';

export function CategoryScreen({
  onOpenCategory,
}: {
  onOpenCategory: (category: Category) => void;
}) {
  const {colors, surfaces, tokens} = useAppTheme();
  const {entries, loading} = useJournalData();
  const counts = categoriesCount(entries);

  return (
    <View style={styles.root}>
      <TopBar title="分类" />
      <FlatList
        data={CATEGORY_ORDER}
        keyExtractor={item => item}
        contentContainerStyle={{
          padding: tokens.contentPadding,
          paddingTop: 16,
          gap: tokens.listSpacing,
        }}
        renderItem={({item}) => {
          const label = CATEGORY_LABEL[item];
          return (
            <SoftCard
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => onOpenCategory(item)}
              radius={16}
              style={styles.row}>
              <View
                style={[
                  styles.iconBlock,
                  {
                    backgroundColor: CATEGORY_ACCENT[item] ?? colors.primary,
                    borderTopWidth: 1,
                    borderTopColor: surfaces.highlightSoft,
                    elevation: 1,
                  },
                ]}>
                <Icon name={CATEGORY_ICON[item]} size={22} color="#FFFFFF" />
              </View>
              <Text style={[styles.label, {color: colors.onSurface}]}>
                {label}
              </Text>
              <Text
                style={[styles.count, {color: colors.onSurfaceVariant}]}>
                {loading ? '加载中' : `${counts[item]} 篇`}
              </Text>
              <Icon
                name="chevron_right"
                size={20}
                color={colors.onSurfaceVariant}
              />
            </SoftCard>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  iconBlock: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {flex: 1, fontSize: 16, fontWeight: '600'},
  count: {fontSize: 13},
});
