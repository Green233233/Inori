import React from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useAppTheme} from '../theme/AppThemeProvider';
import {CATEGORY_ACCENT, onAccentFor} from '../theme/palette';
import {type, tabularNums} from '../theme/typography';
import {GlassIcon} from '../components/GlassIcon';
import {GlassIconName} from '../components/glass-icons.generated';
import {ColorField, SoftCard} from '../components/Surfaces';
import {StaggerReveal} from '../motion/StaggerReveal';
import {useJournalData} from '../data/JournalDataProvider';
import {categoriesCount} from '../data/storage';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  Category,
} from '../data/types';
import {useWindowTokens} from '../theme/window';

export function CategoryScreen({
  onOpenCategory,
}: {
  onOpenCategory: (category: Category) => void;
}) {
  const {colors, tokens} = useAppTheme();
  const windowTokens = useWindowTokens();
  const {entries, loading} = useJournalData();
  const counts = categoriesCount(entries);

  return (
    <FlatList
      data={CATEGORY_ORDER}
      keyExtractor={item => item}
      numColumns={2}
      columnWrapperStyle={{gap: 10}}
      contentContainerStyle={{
        padding: tokens.contentPadding,
        paddingTop: 8,
        paddingBottom: 96,
        gap: 10,
      }}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[type.display, {color: colors.onSurface}]}>分类</Text>
          <Text style={[type.body, {color: colors.onSurfaceVariant}]}>
            按情绪与场景整理你的手账
          </Text>
        </View>
      }
      renderItem={({item, index}) => {
        const label = CATEGORY_LABEL[item];
        const accent = CATEGORY_ACCENT[item] ?? colors.primary;
        const onAccent = onAccentFor(accent);
        return (
          <StaggerReveal index={index} style={styles.cell}>
            <SoftCard
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => onOpenCategory(item)}
              radius={18}
              backgroundColor={accent}
              style={[
                styles.tile,
                {minHeight: windowTokens.isNarrow ? 128 : 146},
              ]}>
              <ColorField color={accent} radius={18} style={StyleSheet.absoluteFill}>
                <View style={styles.tileBody}>
                  <View
                    style={[
                      styles.iconBubble,
                      {backgroundColor: 'rgba(255,255,255,0.18)'},
                    ]}>
                    <GlassIcon
                      name={CATEGORY_ICON[item] as GlassIconName}
                      size={26}
                      tone={onAccent === '#FFFFFF' ? 'light' : 'dark'}
                    />
                  </View>
                  <Text style={[styles.label, {color: onAccent}]}>{label}</Text>
                  <Text
                    style={[
                      type.caption,
                      tabularNums,
                      {color: onAccent, opacity: 0.75},
                    ]}>
                    {loading ? '加载中' : `${counts[item]} 篇`}
                  </Text>
                </View>
              </ColorField>
            </SoftCard>
          </StaggerReveal>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: {paddingTop: 10, paddingBottom: 20, gap: 4},
  cell: {flex: 1},
  tile: {overflow: 'hidden'},
  tileBody: {padding: 14, flex: 1, justifyContent: 'space-between'},
  iconBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {fontSize: 19, fontWeight: '800', letterSpacing: -0.2},
});
