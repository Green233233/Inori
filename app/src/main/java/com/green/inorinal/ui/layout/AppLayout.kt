package com.green.inorinal.ui.layout

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Width-aware layout tokens for phone layouts in the 300–500dp range.
 * Design target: ~380dp. Tokens step down for narrow (300–339) and up for
 * comfortable (≥420) widths without requiring per-screen hardcoding.
 */
data class AppWindowSize(
    val widthDp: Int
) {
    /** Extreme narrow phones / large display-size scaling (~300–339dp). */
    val isNarrow: Boolean get() = widthDp < 340

    /** Compact phones below the 380dp design target. */
    val isCompact: Boolean get() = widthDp < 360

    /** Design-target band around 380dp. */
    val isRegular: Boolean get() = widthDp in 360..419

    /** Wider phones approaching 500dp. */
    val isComfortable: Boolean get() = widthDp >= 420

    val contentPadding: Dp
        get() = when {
            isNarrow -> 10.dp
            isCompact -> 12.dp
            isRegular -> 16.dp
            else -> 20.dp
        }

    val listSpacing: Dp
        get() = when {
            isNarrow -> 8.dp
            isCompact -> 10.dp
            else -> 12.dp
        }

    val cardInnerPaddingHorizontal: Dp
        get() = when {
            isNarrow -> 10.dp
            isCompact -> 12.dp
            else -> 16.dp
        }

    val cardInnerPaddingVertical: Dp
        get() = when {
            isNarrow -> 10.dp
            isCompact -> 12.dp
            else -> 14.dp
        }

    val cardMinHeight: Dp
        get() = when {
            isNarrow -> 92.dp
            isCompact -> 98.dp
            else -> 104.dp
        }

    val cardDateWidth: Dp
        get() = when {
            isNarrow -> 36.dp
            isCompact -> 44.dp
            else -> 52.dp
        }

    val cardDateFontSp: Int
        get() = when {
            isNarrow -> 24
            isCompact -> 28
            else -> 34
        }

    val cardDateGap: Dp
        get() = when {
            isNarrow -> 8.dp
            isCompact -> 10.dp
            else -> 14.dp
        }

    val cardActionSize: Dp
        get() = if (isNarrow) 40.dp else 48.dp

    val cardCorner: Dp
        get() = if (isCompact) 16.dp else 18.dp

    val fabBottomInset: Dp
        get() = if (isNarrow) 88.dp else 104.dp

    val emptyIconSize: Dp
        get() = if (isNarrow) 48.dp else 60.dp

    val brandTitleSp: Int
        get() = if (isNarrow) 20 else 24

    val avatarSize: Dp
        get() = when {
            isNarrow -> 76.dp
            isCompact -> 88.dp
            else -> 100.dp
        }

    val avatarIconSize: Dp
        get() = when {
            isNarrow -> 60.dp
            isCompact -> 70.dp
            else -> 80.dp
        }

    val profileNameSp: Int
        get() = if (isNarrow) 18 else 22

    val statValueSp: Int
        get() = if (isNarrow) 16 else 20

    val sectionGap: Dp
        get() = when {
            isNarrow -> 20.dp
            isCompact -> 24.dp
            else -> 32.dp
        }

    val aboutHeroSp: Int
        get() = when {
            isNarrow -> 36
            isCompact -> 42
            else -> 48
        }

    val aboutIconSize: Dp
        get() = when {
            isNarrow -> 88.dp
            isCompact -> 104.dp
            else -> 120.dp
        }

    val aboutTopSpacer: Dp
        get() = when {
            isNarrow -> 24.dp
            isCompact -> 32.dp
            else -> 60.dp
        }

    val sheetHorizontalPadding: Dp
        get() = if (isNarrow) 14.dp else 20.dp

    val toolbarPanelPadding: Dp
        get() = if (isNarrow) 6.dp else 8.dp

    val imagePreviewHeight: Dp
        get() = when {
            isNarrow -> 280.dp
            isCompact -> 340.dp
            else -> 420.dp
        }

    val navLabelSp: Int
        get() = if (isNarrow) 10 else 11

    val stickerColumns: Int
        get() = when {
            isNarrow -> 4
            isCompact -> 4
            else -> 5
        }

    val stickerCell: Dp
        get() = when {
            isNarrow -> 40.dp
            isCompact -> 44.dp
            else -> 52.dp
        }

    val stickerEmojiSp: Int
        get() = if (isCompact) 22 else 28
}

@Composable
fun rememberAppWindowSize(): AppWindowSize {
    val widthDp = LocalConfiguration.current.screenWidthDp
    return remember(widthDp) { AppWindowSize(widthDp) }
}
