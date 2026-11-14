import React, {useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {EntrySummary, CATEGORY_LABEL, dateLabel} from '../data/types';
import {useAppTheme} from '../theme/AppThemeProvider';
import {withAlpha} from '../theme/palette';
import {Icon} from './Icon';
import {Pill} from './Ui';
import {GlassSurface, SoftCard} from './Surfaces';

/**
 * Flat color-block journal card: a solid date block on the left, title and
 * preview on the right, flat meta pills underneath. No gradient/shadow.
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
  const {colors, surfaces, tokens} = useAppTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const {day, month} = dateLabel(entry.date);
  const preview = entry.preview.trim();

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
        <View
          style={[
            styles.dateBlock,
            {
              width: tokens.cardDateWidth,
              borderRadius: Math.max(8, tokens.cardCorner - 6),
              backgroundColor: colors.primaryContainer,
              borderTopWidth: 1,
              borderTopColor: surfaces.highlight,
              borderBottomWidth: 1,
              borderBottomColor: surfaces.shadowSoft,
              elevation: 1,
            },
          ]}>
          <Text
            style={{
              fontSize: tokens.cardDateFontSize,
              lineHeight: tokens.cardDateFontSize + 2,
              fontWeight: '700',
              color: colors.onPrimaryContainer,
            }}>
            {day}
          </Text>
          <Text
            style={{
              fontSize: tokens.isNarrow ? 10 : 11,
              fontWeight: '600',
              color: colors.onPrimaryContainer,
              opacity: 0.8,
            }}>
            {month}
          </Text>
        </View>

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
              <Icon
                name="more_vert"
                size={18}
                color={colors.onSurfaceVariant}
              />
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
              icon={weatherIcon(entry.weather)}
              color={colors.primary}
              background={withAlpha(colors.primary, 0.09)}
            />
            <Pill
              icon={moodIcon(entry.mood)}
              color={colors.primary}
              background={withAlpha(colors.primary, 0.09)}
            />
            {!tokens.isNarrow && entry.category !== 'ALL' ? (
              <Pill
                text={CATEGORY_LABEL[entry.category]}
                color={colors.onSurfaceVariant}
                background={withAlpha(colors.primary, 0.09)}
              />
            ) : null}
            {entry.isFavorite ? (
              <View style={styles.favoriteMark}>
                <Icon name="favorite" size={13} color="#D97D78" />
              </View>
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
                <Icon
                  name={entry.isFavorite ? 'favorite' : 'favorite_border'}
                  size={20}
                  color={colors.onSurfaceVariant}
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
                <Icon name="delete" size={20} color={colors.error} />
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

function weatherIcon(weather: EntrySummary['weather']): string {
  switch (weather) {
    case 'RAINY':
      return 'water_drop';
    case 'CLOUDY':
      return 'cloud';
    case 'NIGHT_CLEAR':
      return 'nights_stay';
    default:
      return 'wb_sunny';
  }
}

function moodIcon(mood: EntrySummary['mood']): string {
  switch (mood) {
    case 'HAPPY':
      return 'sentiment_very_satisfied';
    case 'SAD':
      return 'sentiment_very_dissatisfied';
    default:
      return 'sentiment_neutral';
  }
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
