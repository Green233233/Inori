package com.green.inorinal.ui.icons

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.NightsStay
import androidx.compose.material.icons.outlined.SentimentNeutral
import androidx.compose.material.icons.outlined.SentimentVeryDissatisfied
import androidx.compose.material.icons.outlined.SentimentVerySatisfied
import androidx.compose.material.icons.outlined.WaterDrop
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.green.inorinal.data.Mood
import com.green.inorinal.data.Weather
import com.green.inorinal.ui.theme.DarkGrey
import com.green.inorinal.ui.theme.FavoriteRed
import com.green.inorinal.ui.theme.SakuraPink
import com.green.inorinal.ui.theme.StarYellow

/**
 * Application icon set backed by the official Material Icons vectors (Apache 2.0).
 *
 * Keeping these wrappers centralizes icon semantics and styling while allowing call sites
 * to remain independent of the selected open-source icon library.
 */
@Composable
private fun MaterialVectorIcon(
    imageVector: ImageVector,
    size: Dp,
    tint: Color,
    contentDescription: String?
) {
    Icon(
        imageVector = imageVector,
        contentDescription = contentDescription,
        modifier = Modifier.size(size),
        tint = tint
    )
}

// Weather

@Composable
fun WeatherSunnyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    MaterialVectorIcon(Icons.Outlined.WbSunny, size, tint, "晴天")
}

@Composable
fun WeatherRainyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    MaterialVectorIcon(Icons.Outlined.WaterDrop, size, tint, "雨天")
}

@Composable
fun WeatherCloudyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    MaterialVectorIcon(Icons.Outlined.Cloud, size, tint, "多云")
}

@Composable
fun WeatherNightClearIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    MaterialVectorIcon(Icons.Outlined.NightsStay, size, tint, "晴朗夜晚")
}

// Mood

@Composable
fun MoodHappyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    MaterialVectorIcon(Icons.Outlined.SentimentVerySatisfied, size, tint, "开心")
}

@Composable
fun MoodCalmIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    MaterialVectorIcon(Icons.Outlined.SentimentNeutral, size, tint, "平静")
}

@Composable
fun MoodSadIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    MaterialVectorIcon(Icons.Outlined.SentimentVeryDissatisfied, size, tint, "难过")
}

// Profile and decorative icons

@Composable
fun ProfileAvatarIcon(size: Dp = 80.dp, tint: Color = SakuraPink) {
    MaterialVectorIcon(Icons.Outlined.AccountCircle, size, tint, "用户头像")
}

@Composable
fun AppIdentityIcon(size: Dp = 80.dp, tint: Color = SakuraPink) {
    MaterialVectorIcon(Icons.Outlined.AutoStories, size, tint, "祈日记")
}

@Composable
fun HeartIcon(size: Dp = 24.dp, tint: Color = FavoriteRed) {
    MaterialVectorIcon(Icons.Filled.Favorite, size, tint, null)
}

@Composable
fun StarIcon(size: Dp = 24.dp, tint: Color = StarYellow) {
    MaterialVectorIcon(Icons.Filled.Star, size, tint, null)
}

@Composable
fun WeatherIcon(weather: Weather, size: Dp = 24.dp, tint: Color = DarkGrey) {
    when (weather.normalized()) {
        Weather.SUNNY -> WeatherSunnyIcon(size, tint)
        Weather.RAINY -> WeatherRainyIcon(size, tint)
        Weather.CLOUDY -> WeatherCloudyIcon(size, tint)
        Weather.NIGHT_CLEAR -> WeatherNightClearIcon(size, tint)
        else -> WeatherCloudyIcon(size, tint)
    }
}

@Composable
fun MoodIcon(mood: Mood, size: Dp = 24.dp, tint: Color = DarkGrey) {
    when (mood.normalized()) {
        Mood.HAPPY -> MoodHappyIcon(size, tint)
        Mood.CALM -> MoodCalmIcon(size, tint)
        Mood.SAD -> MoodSadIcon(size, tint)
        else -> MoodCalmIcon(size, tint)
    }
}
