import {useWindowDimensions} from 'react-native';

/**
 * Width-aware layout tokens (port of ui/layout/AppLayout.kt).
 * Design target ~380dp; steps down for 300–339dp and up for ≥420dp.
 */
export interface WindowTokens {
  width: number;
  isNarrow: boolean; // < 340
  isCompact: boolean; // < 360
  isRegular: boolean; // 360–419
  isComfortable: boolean; // >= 420
  contentPadding: number;
  listSpacing: number;
  cardInnerPaddingHorizontal: number;
  cardInnerPaddingVertical: number;
  cardMinHeight: number;
  cardDateWidth: number;
  cardDateFontSize: number;
  cardDateGap: number;
  cardActionSize: number;
  cardCorner: number;
  fabBottomInset: number;
  emptyIconSize: number;
  brandTitleSize: number;
  avatarSize: number;
  avatarIconSize: number;
  profileNameSize: number;
  statValueSize: number;
  sectionGap: number;
  aboutHeroSize: number;
  aboutIconSize: number;
  aboutTopSpacer: number;
  sheetPadding: number;
  toolbarPanelPadding: number;
  imagePreviewHeight: number;
  navLabelSize: number;
  stickerColumns: number;
  stickerCell: number;
  stickerEmojiSize: number;
}

export function getWindowTokens(width: number): WindowTokens {
  const isNarrow = width < 340;
  const isCompact = width < 360;
  const isRegular = width >= 360 && width < 420;
  const pick = (narrow: number, compact: number, other: number) =>
    isNarrow ? narrow : isCompact ? compact : other;
  return {
    width,
    isNarrow,
    isCompact,
    isRegular,
    isComfortable: width >= 420,
    contentPadding: pick(10, 12, isRegular ? 16 : 20),
    listSpacing: pick(8, 10, 12),
    cardInnerPaddingHorizontal: pick(10, 12, 16),
    cardInnerPaddingVertical: pick(12, 14, 16),
    cardMinHeight: pick(100, 108, 116),
    cardDateWidth: pick(40, 50, 58),
    cardDateFontSize: pick(24, 28, 32),
    cardDateGap: pick(8, 10, 14),
    cardActionSize: isNarrow ? 40 : 48,
    cardCorner: isCompact ? 16 : 18,
    fabBottomInset: isNarrow ? 88 : 104,
    emptyIconSize: isNarrow ? 48 : 60,
    brandTitleSize: isNarrow ? 20 : 22,
    avatarSize: pick(76, 84, 96),
    avatarIconSize: pick(60, 70, 80),
    profileNameSize: isNarrow ? 18 : 22,
    statValueSize: isNarrow ? 18 : 24,
    sectionGap: pick(20, 24, 28),
    aboutHeroSize: pick(36, 42, 48),
    aboutIconSize: pick(88, 104, 120),
    aboutTopSpacer: pick(24, 32, 60),
    sheetPadding: isNarrow ? 14 : 20,
    toolbarPanelPadding: isNarrow ? 6 : 8,
    imagePreviewHeight: pick(280, 340, 420),
    navLabelSize: isNarrow ? 10 : 11,
    stickerColumns: width < 420 ? 4 : 5,
    stickerCell: pick(40, 44, 52),
    stickerEmojiSize: isCompact ? 22 : 28,
  };
}

export function useWindowTokens(): WindowTokens {
  const {width} = useWindowDimensions();
  return getWindowTokens(width);
}
