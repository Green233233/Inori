import React, {useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  EntrySummary,
  CATEGORY_LABEL,
  MOOD_LABEL,
  WEATHER_LABEL,
  dateLabel,
} from '../data/types';
import {useAppTheme} from '../theme/AppThemeProvider';
import {CATEGORY_ACCENT, onAccentFor, withAlpha} from '../theme/palette';
import {GlassIcon} from './GlassIcon';
import {FavoriteButton} from '../motion/FavoriteButton';
import {Pill} from './Ui';
import {ColorField, GlassSurface, SoftCard} from './Surfaces';

/**
 * Editorial journal card: a saturated date cover, flat/soft surface, and
 * compact metadata. No warm neumorphic borders or gradient backgrounds.
 */
export function JournalCard({
  entry,
  onPress,
  onFavorite,
  onDelete,
}: {
  entry: EntrySummary;
  onPress: () => void;
  onFavorite?: () => void;
  onDelete?: () => void;
}) {
  const {colors, tokens} = useAppTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const {day, month} = dateLabel(entry.date);
  const preview = entry.preview.trim();
  const accent = CATEGORY_ACCENT[entry.category] ?? colors.primary;
  const onAccent = onAccentFor(accent);

  const closeMenu = () => setMenuVisible(false);

  return (
    <>
      <SoftCard
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}，${entry.date}`}
        onPress={onPress}
        onLongPress={() => setMenuVisible(true)}
        radius={tokens.cardCorner}
        style={{
          minHeight: tokens.cardMinHeight,
          flexDirection: 'row',
        }}>
        <ColorField
          color={accent}
          radius={12}
          style={[
            styles.dateBlock,
            {
              width: tokens.cardDateWidth,
            },
          ]}>
          <Text
            style={{
              fontSize: tokens.cardDateFontSize,
              lineHeight: tokens.cardDateFontSize + 2,
              fontWeight: '700',
              color: onAccent,
              fontVariant: ['tabular-nums'],
            }}>
            {day}
          </Text>
          <Text
            style={{
              fontSize: tokens.isNarrow ? 10 : 11,
              fontWeight: '600',
              color: onAccent,
              opacity: 0.85,
            }}>
            {month}
          </Text>
        </ColorField>

        <View
          style={[
            styles.content,
            {
              paddingVertical: tokens.cardInnerPaddingVertical,
              paddingRight: tokens.isNarrow ? 2 : 8,
            },
          ]}>
          <View style={styles.titleRow}>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontSize: tokens.isNarrow ? 14 : 16,
                fontWeight: '700',
                color: colors.onSurface,
              }}>
              {entry.title || '未命名日记'}
            </Text>
            {entry.readOnly ? (
              <Pill
                text="TA"
                color={colors.onSurfaceVariant}
                background={withAlpha(colors.outline, 0.35)}
              />
            ) : entry.visibility === 'private' ? (
              <Pill
                text="私密"
                color={colors.onSurfaceVariant}
                background={withAlpha(colors.outline, 0.35)}
              />
            ) : null}
              {onFavorite ? (
                <FavoriteButton
                  active={entry.isFavorite}
                  onPress={onFavorite}
                />
              ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="更多操作"
              focusable={false}
              hitSlop={8}
              onPress={() => setMenuVisible(true)}
              style={({pressed}) => [
                styles.moreButton,
                {
                  width: tokens.cardActionSize,
                  height: tokens.cardActionSize,
                  backgroundColor: pressed
                    ? withAlpha(colors.onSurface, 0.06)
                    : 'transparent',
                },
              ]}>
              <GlassIcon name="more" size={20} />
            </Pressable>
          </View>

          <Text
            numberOfLines={2}
            style={{
              marginTop: 2,
              fontSize: tokens.isNarrow ? 12 : 13,
              lineHeight: tokens.isNarrow ? 17 : 19,
              color: colors.onSurfaceVariant,
              opacity: preview ? 0.86 : 0.58,
            }}>
            {preview || '暂无正文'}
          </Text>

          <View style={styles.metaRow}>
            <Pill
              text={WEATHER_LABEL[entry.weather]}
              color={colors.onSurfaceVariant}
              background={withAlpha(colors.onSurfaceVariant, 0.12)}
            />
            <Pill
              text={MOOD_LABEL[entry.mood]}
              color={colors.onSurfaceVariant}
              background={withAlpha(colors.onSurfaceVariant, 0.12)}
            />
            {!tokens.isNarrow && entry.category !== 'ALL' ? (
              <Pill
                text={CATEGORY_LABEL[entry.category]}
                color={colors.onSurfaceVariant}
                background={withAlpha(colors.primary, 0.09)}
              />
            ) : null}
            {entry.isFavorite ? (
              <Pill
                text="已收藏"
                color="#FF375F"
                background={withAlpha('#FF375F', 0.14)}
              />
            ) : null}
          </View>
        </View>
      </SoftCard>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}>
        <Pressable style={styles.menuScrim} onPress={closeMenu}>
          <GlassSurface strong radius={20} elevation={16} style={styles.menuCard}>
            <Text
              numberOfLines={1}
              style={[styles.menuTitle, {color: colors.onSurfaceVariant}]}>
              {entry.title || '未命名日记'}
            </Text>
            {onFavorite ? (
              <Pressable
                accessibilityRole="button"
                style={({pressed}) => [
                  styles.menuItem,
                  pressed && {backgroundColor: withAlpha(colors.primary, 0.08)},
                ]}
                onPress={() => {
                  closeMenu();
                  onFavorite();
                }}>
                <GlassIcon
                  name="favorite"
                  size={20}
                  tone={entry.isFavorite ? 'onAccent' : 'auto'}
                />
                <Text style={[styles.menuLabel, {color: colors.onSurface}]}>
                  {entry.isFavorite ? '取消收藏' : '收藏'}
                </Text>
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable
                accessibilityRole="button"
                style={({pressed}) => [
                  styles.menuItem,
                  pressed && {backgroundColor: withAlpha(colors.error, 0.08)},
                ]}
                onPress={() => {
                  closeMenu();
                  onDelete();
                }}>
                <GlassIcon name="delete" size={20} />
                <Text style={[styles.menuLabel, {color: colors.error}]}>
                  删除
                </Text>
              </Pressable>
            ) : null}
          </GlassSurface>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dateBlock: {
    alignSelf: 'stretch',
    margin: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  content: {
    flex: 1,
    marginLeft: 4,
    justifyContent: 'center',
  },
  titleRow: {flexDirection: 'row', alignItems: 'center'},
  moreButton: {alignItems: 'center', justifyContent: 'center', borderRadius: 20},
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 7,
  },
  favoriteMark: {marginLeft: 2},
  menuScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  menuCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 18,
    paddingVertical: 8,
  },
  menuTitle: {
    fontSize: 12,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  menuLabel: {fontSize: 15, fontWeight: '500'},
});
