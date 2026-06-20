package com.green.inorinal.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.graphics.Color
import androidx.core.view.WindowCompat
import com.green.inorinal.data.AppColorStyle
import com.green.inorinal.data.AppThemeMode

// ==================== 樱花粉浅色 ====================
private val SakuraLightColorScheme = lightColorScheme(
    primary = SakuraPink,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = SakuraPinkContainer,
    onPrimaryContainer = SakuraOnPinkContainer,
    secondary = CherryPink,
    onSecondary = DarkGrey,
    secondaryContainer = LightPink,
    onSecondaryContainer = Color(0xFF5C2329),
    tertiary = PinkGradientStart,
    onTertiary = DarkGrey,
    background = RiceWhite,
    onBackground = DarkGrey,
    surface = OffWhite,
    onSurface = DarkGrey,
    surfaceVariant = LightPink,
    onSurfaceVariant = Color(0xFF665658),
    outline = Color(0xFF9C8C8E),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF)
)

// ==================== 樱花粉深色 ====================
private val SakuraDarkColorScheme = darkColorScheme(
    primary = SakuraDarkPrimary,
    onPrimary = SakuraDarkBackground,
    primaryContainer = Color(0xFF5C2329),
    onPrimaryContainer = SakuraPinkContainer,
    secondary = SakuraPinkDark,
    onSecondary = SakuraDarkBackground,
    secondaryContainer = SakuraDarkSurfaceVariant,
    onSecondaryContainer = LightPink,
    tertiary = PinkGradientStart,
    onTertiary = SakuraDarkBackground,
    background = SakuraDarkBackground,
    onBackground = SakuraDarkOnBackground,
    surface = SakuraDarkSurface,
    onSurface = SakuraDarkOnSurface,
    surfaceVariant = SakuraDarkSurfaceVariant,
    onSurfaceVariant = SakuraDarkOnSurfaceVariant,
    outline = Color(0xFF7E6E70),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005)
)

// ==================== 薄荷绿浅色 ====================
private val MintLightColorScheme = lightColorScheme(
    primary = MintGreen,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = MintGreenContainer,
    onPrimaryContainer = MintOnGreenContainer,
    secondary = PaleGreen,
    onSecondary = DarkGrey,
    secondaryContainer = PaleGreen,
    onSecondaryContainer = Color(0xFF1A3B3A),
    tertiary = SkyBlue,
    onTertiary = DarkGrey,
    background = RiceWhite,
    onBackground = DarkGrey,
    surface = OffWhite,
    onSurface = DarkGrey,
    surfaceVariant = PaleGreen,
    onSurfaceVariant = Color(0xFF3F4948),
    outline = Color(0xFF6F7978),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF)
)

// ==================== 薄荷绿深色 ====================
private val MintDarkColorScheme = darkColorScheme(
    primary = MintDarkPrimary,
    onPrimary = MintDarkBackground,
    primaryContainer = Color(0xFF1A3B3A),
    onPrimaryContainer = MintGreenContainer,
    secondary = MintGreenDark,
    onSecondary = MintDarkBackground,
    secondaryContainer = MintDarkSurfaceVariant,
    onSecondaryContainer = PaleGreen,
    tertiary = SkyBlue,
    onTertiary = MintDarkBackground,
    background = MintDarkBackground,
    onBackground = MintDarkOnBackground,
    surface = MintDarkSurface,
    onSurface = MintDarkOnSurface,
    surfaceVariant = MintDarkSurfaceVariant,
    onSurfaceVariant = MintDarkOnSurfaceVariant,
    outline = Color(0xFF6F7978),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005)
)

@Composable
fun InorinalTheme(
    colorStyle: AppColorStyle = AppColorStyle.SAKURA,
    themeMode: AppThemeMode = AppThemeMode.SYSTEM,
    content: @Composable () -> Unit
) {
    val useDarkTheme = when (themeMode) {
        AppThemeMode.LIGHT -> false
        AppThemeMode.DARK -> true
        AppThemeMode.SYSTEM -> isSystemInDarkTheme()
    }
    val context = LocalContext.current
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !useDarkTheme
                isAppearanceLightNavigationBars = !useDarkTheme
            }
        }
    }

    val colorScheme = when (colorStyle) {
        AppColorStyle.SAKURA -> if (useDarkTheme) SakuraDarkColorScheme else SakuraLightColorScheme
        AppColorStyle.MINT -> if (useDarkTheme) MintDarkColorScheme else MintLightColorScheme
        AppColorStyle.SYSTEM -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (useDarkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
            } else {
                if (useDarkTheme) SakuraDarkColorScheme else SakuraLightColorScheme
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
