package com.green.inorinal.ui.icons

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.green.inorinal.ui.theme.*
import kotlin.math.cos
import kotlin.math.sin

// ==================== 天气图标 ====================

@Composable
fun WeatherSunnyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val center = Offset(s / 2, s / 2)
        val radius = s * 0.2f
        val rayLength = s * 0.12f
        val rayStart = radius + s * 0.08f

        drawCircle(color = tint, radius = radius, center = center)

        for (i in 0 until 8) {
            val angle = i * 45f
            rotate(angle, center) {
                drawLine(
                    color = tint,
                    start = Offset(center.x, center.y - rayStart),
                    end = Offset(center.x, center.y - rayStart - rayLength),
                    strokeWidth = s * 0.05f,
                    cap = StrokeCap.Round
                )
            }
        }
    }
}

@Composable
fun WeatherRainyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val cloudColor = tint.copy(alpha = 0.7f)
        // 云朵
        drawCircle(color = cloudColor, radius = s * 0.15f, center = Offset(s * 0.38f, s * 0.3f))
        drawCircle(color = cloudColor, radius = s * 0.19f, center = Offset(s * 0.52f, s * 0.26f))
        drawCircle(color = cloudColor, radius = s * 0.14f, center = Offset(s * 0.65f, s * 0.32f))
        drawRect(color = cloudColor, topLeft = Offset(s * 0.28f, s * 0.3f), size = Size(s * 0.42f, s * 0.1f))

        // 雨滴
        for (i in 0 until 3) {
            val x = s * (0.35f + i * 0.14f)
            val y = s * 0.48f
            val path = Path().apply {
                moveTo(x, y + s * 0.1f)
                quadraticTo(x - s * 0.035f, y + s * 0.03f, x, y)
                quadraticTo(x + s * 0.035f, y + s * 0.03f, x, y + s * 0.1f)
            }
            drawPath(path = path, color = tint, style = Fill)
        }
    }
}

@Composable
fun WeatherCloudyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        // 后面的云（半透明）
        drawCircle(color = tint.copy(alpha = 0.35f), radius = s * 0.14f, center = Offset(s * 0.55f, s * 0.28f))
        drawCircle(color = tint.copy(alpha = 0.35f), radius = s * 0.17f, center = Offset(s * 0.68f, s * 0.3f))
        drawRect(color = tint.copy(alpha = 0.35f), topLeft = Offset(s * 0.45f, s * 0.3f), size = Size(s * 0.36f, s * 0.08f))

        // 前面的云
        drawCircle(color = tint, radius = s * 0.17f, center = Offset(s * 0.35f, s * 0.4f))
        drawCircle(color = tint, radius = s * 0.21f, center = Offset(s * 0.5f, s * 0.36f))
        drawCircle(color = tint, radius = s * 0.15f, center = Offset(s * 0.63f, s * 0.42f))
        drawRect(color = tint, topLeft = Offset(s * 0.25f, s * 0.42f), size = Size(s * 0.46f, s * 0.1f))
    }
}

@Composable
fun WeatherNightClearIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        // 月亮 - 使用原生 Canvas clipPath 实现月牙
        val mainRadius = s * 0.32f
        val cutRadius = s * 0.28f
        val mainCenter = Offset(s * 0.45f, s * 0.45f)
        val cutCenter = Offset(s * 0.58f, s * 0.35f)

        drawIntoCanvas { canvas ->
            val nativeCanvas = canvas.nativeCanvas
            val paint = android.graphics.Paint().apply {
                color = tint.toArgb()
                isAntiAlias = true
                style = android.graphics.Paint.Style.FILL
            }
            nativeCanvas.save()

            // 裁剪到大圆区域
            val mainPath = android.graphics.Path().apply {
                addCircle(mainCenter.x, mainCenter.y, mainRadius, android.graphics.Path.Direction.CW)
            }
            nativeCanvas.clipPath(mainPath)

            // 从大圆中减去小圆
            val cutPath = android.graphics.Path().apply {
                addCircle(cutCenter.x, cutCenter.y, cutRadius, android.graphics.Path.Direction.CW)
            }
            nativeCanvas.clipPath(cutPath, android.graphics.Region.Op.DIFFERENCE)

            // 填充裁剪后的月牙区域
            nativeCanvas.drawRect(0f, 0f, s, s, paint)
            nativeCanvas.restore()
        }

        // 星星
        val starPositions = listOf(Offset(s * 0.78f, s * 0.2f), Offset(s * 0.85f, s * 0.45f), Offset(s * 0.72f, s * 0.65f))
        starPositions.forEach { pos ->
            drawCircle(color = tint, radius = s * 0.02f, center = pos)
        }
    }
}

@Composable
fun WeatherSnowyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val cloudColor = tint.copy(alpha = 0.7f)
        // 云朵
        drawCircle(color = cloudColor, radius = s * 0.15f, center = Offset(s * 0.38f, s * 0.26f))
        drawCircle(color = cloudColor, radius = s * 0.19f, center = Offset(s * 0.52f, s * 0.22f))
        drawCircle(color = cloudColor, radius = s * 0.14f, center = Offset(s * 0.65f, s * 0.28f))
        drawRect(color = cloudColor, topLeft = Offset(s * 0.28f, s * 0.28f), size = Size(s * 0.42f, s * 0.08f))

        // 雪花
        for (i in 0 until 3) {
            val x = s * (0.33f + i * 0.15f)
            val y = s * 0.5f
            drawCircle(color = tint, radius = s * 0.025f, center = Offset(x, y))
            drawLine(color = tint, start = Offset(x - s * 0.04f, y), end = Offset(x + s * 0.04f, y), strokeWidth = s * 0.015f)
            drawLine(color = tint, start = Offset(x, y - s * 0.04f), end = Offset(x, y + s * 0.04f), strokeWidth = s * 0.015f)
            drawLine(color = tint, start = Offset(x - s * 0.03f, y - s * 0.03f), end = Offset(x + s * 0.03f, y + s * 0.03f), strokeWidth = s * 0.012f)
            drawLine(color = tint, start = Offset(x + s * 0.03f, y - s * 0.03f), end = Offset(x - s * 0.03f, y + s * 0.03f), strokeWidth = s * 0.012f)
        }
    }
}

// ==================== 心情图标 ====================

@Composable
fun MoodHappyIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val center = Offset(s / 2, s / 2)
        val radius = s * 0.38f

        drawCircle(color = tint.copy(alpha = 0.12f), radius = radius, center = center)
        drawCircle(color = tint, radius = radius, center = center, style = Stroke(width = s * 0.04f))

        // 眼睛
        drawCircle(color = tint, radius = s * 0.04f, center = Offset(s * 0.38f, s * 0.4f))
        drawCircle(color = tint, radius = s * 0.04f, center = Offset(s * 0.62f, s * 0.4f))

        // 微笑
        val smilePath = Path().apply {
            arcTo(
                rect = Rect(Offset(s * 0.34f, s * 0.42f), Size(s * 0.32f, s * 0.24f)),
                startAngleDegrees = 20f,
                sweepAngleDegrees = 140f,
                forceMoveTo = true
            )
        }
        drawPath(path = smilePath, color = tint, style = Stroke(width = s * 0.04f, cap = StrokeCap.Round))
    }
}

@Composable
fun MoodCalmIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val center = Offset(s / 2, s / 2)
        val radius = s * 0.38f

        drawCircle(color = tint.copy(alpha = 0.12f), radius = radius, center = center)
        drawCircle(color = tint, radius = radius, center = center, style = Stroke(width = s * 0.04f))

        // 闭眼
        drawLine(color = tint, start = Offset(s * 0.33f, s * 0.42f), end = Offset(s * 0.43f, s * 0.42f), strokeWidth = s * 0.04f, cap = StrokeCap.Round)
        drawLine(color = tint, start = Offset(s * 0.57f, s * 0.42f), end = Offset(s * 0.67f, s * 0.42f), strokeWidth = s * 0.04f, cap = StrokeCap.Round)

        // 平静的嘴
        drawLine(color = tint, start = Offset(s * 0.4f, s * 0.6f), end = Offset(s * 0.6f, s * 0.6f), strokeWidth = s * 0.04f, cap = StrokeCap.Round)
    }
}

@Composable
fun MoodExcitedIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val center = Offset(s / 2, s / 2)
        val radius = s * 0.38f

        drawCircle(color = tint.copy(alpha = 0.12f), radius = radius, center = center)
        drawCircle(color = tint, radius = radius, center = center, style = Stroke(width = s * 0.04f))

        // 星星眼
        drawStar(Offset(s * 0.38f, s * 0.4f), s * 0.05f, tint)
        drawStar(Offset(s * 0.62f, s * 0.4f), s * 0.05f, tint)

        // 张嘴笑
        drawArc(
            color = tint,
            startAngle = 10f,
            sweepAngle = 160f,
            useCenter = true,
            topLeft = Offset(s * 0.36f, s * 0.48f),
            size = Size(s * 0.28f, s * 0.18f)
        )
    }
}

private fun DrawScope.drawStar(center: Offset, radius: Float, color: Color) {
    val path = Path().apply {
        for (i in 0 until 5) {
            val angle = Math.toRadians((i * 72.0 - 90.0))
            val x = center.x + radius * cos(angle).toFloat()
            val y = center.y + radius * sin(angle).toFloat()
            if (i == 0) moveTo(x, y) else lineTo(x, y)
            val innerAngle = Math.toRadians((i * 72.0 + 36.0 - 90.0))
            val ix = center.x + radius * 0.4f * cos(innerAngle).toFloat()
            val iy = center.y + radius * 0.4f * sin(innerAngle).toFloat()
            lineTo(ix, iy)
        }
        close()
    }
    drawPath(path = path, color = color, style = Fill)
}

@Composable
fun MoodProudIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val center = Offset(s / 2, s / 2)
        val radius = s * 0.38f

        drawCircle(color = tint.copy(alpha = 0.12f), radius = radius, center = center)
        drawCircle(color = tint, radius = radius, center = center, style = Stroke(width = s * 0.04f))

        // 眼睛
        drawCircle(color = tint, radius = s * 0.04f, center = Offset(s * 0.38f, s * 0.4f))
        drawCircle(color = tint, radius = s * 0.04f, center = Offset(s * 0.62f, s * 0.4f))

        // 得意的嘴（波浪形）
        val smilePath = Path().apply {
            moveTo(s * 0.34f, s * 0.56f)
            quadraticTo(s * 0.42f, s * 0.64f, s * 0.5f, s * 0.58f)
            quadraticTo(s * 0.58f, s * 0.52f, s * 0.66f, s * 0.56f)
        }
        drawPath(path = smilePath, color = tint, style = Stroke(width = s * 0.04f, cap = StrokeCap.Round))
    }
}

@Composable
fun MoodEmotionalIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val center = Offset(s / 2, s / 2)
        val radius = s * 0.38f

        drawCircle(color = tint.copy(alpha = 0.12f), radius = radius, center = center)
        drawCircle(color = tint, radius = radius, center = center, style = Stroke(width = s * 0.04f))

        // 眼睛
        drawCircle(color = tint, radius = s * 0.04f, center = Offset(s * 0.38f, s * 0.4f))
        drawCircle(color = tint, radius = s * 0.04f, center = Offset(s * 0.62f, s * 0.4f))

        // 泪滴
        drawOval(color = tint.copy(alpha = 0.5f), topLeft = Offset(s * 0.36f, s * 0.46f), size = Size(s * 0.04f, s * 0.07f))

        // 波浪嘴
        val mouthPath = Path().apply {
            moveTo(s * 0.36f, s * 0.62f)
            quadraticTo(s * 0.42f, s * 0.58f, s * 0.5f, s * 0.62f)
            quadraticTo(s * 0.58f, s * 0.66f, s * 0.64f, s * 0.62f)
        }
        drawPath(path = mouthPath, color = tint, style = Stroke(width = s * 0.04f, cap = StrokeCap.Round))
    }
}

@Composable
fun MoodSadIcon(size: Dp = 24.dp, tint: Color = DarkGrey) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val center = Offset(s / 2, s / 2)
        val radius = s * 0.38f

        drawCircle(color = tint.copy(alpha = 0.12f), radius = radius, center = center)
        drawCircle(color = tint, radius = radius, center = center, style = Stroke(width = s * 0.04f))

        // 眼睛
        drawCircle(color = tint, radius = s * 0.04f, center = Offset(s * 0.38f, s * 0.4f))
        drawCircle(color = tint, radius = s * 0.04f, center = Offset(s * 0.62f, s * 0.4f))

        // 悲伤的嘴（倒弧）
        val sadPath = Path().apply {
            arcTo(
                rect = Rect(Offset(s * 0.34f, s * 0.56f), Size(s * 0.32f, s * 0.18f)),
                startAngleDegrees = 220f,
                sweepAngleDegrees = 100f,
                forceMoveTo = true
            )
        }
        drawPath(path = sadPath, color = tint, style = Stroke(width = s * 0.04f, cap = StrokeCap.Round))
    }
}

// ==================== 云朵头像 ====================

@Composable
fun CloudAvatarIcon(size: Dp = 80.dp, tint: Color = SakuraPink) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        // 简化的云朵形状 - 用多个圆组成
        val cloudColor = tint.copy(alpha = 0.3f)
        val cloudStroke = tint

        // 底部矩形
        drawRect(color = cloudColor, topLeft = Offset(s * 0.15f, s * 0.5f), size = Size(s * 0.7f, s * 0.15f))
        // 左侧圆
        drawCircle(color = cloudColor, radius = s * 0.18f, center = Offset(s * 0.33f, s * 0.5f))
        // 中间大圆
        drawCircle(color = cloudColor, radius = s * 0.22f, center = Offset(s * 0.5f, s * 0.42f))
        // 右侧圆
        drawCircle(color = cloudColor, radius = s * 0.16f, center = Offset(s * 0.67f, s * 0.48f))

        // 描边
        val outlinePath = Path().apply {
            moveTo(s * 0.15f, s * 0.55f)
            lineTo(s * 0.15f, s * 0.5f)
            arcTo(
                rect = Rect(Offset(s * 0.15f, s * 0.32f), Size(s * 0.36f, s * 0.36f)),
                startAngleDegrees = 180f,
                sweepAngleDegrees = 180f,
                forceMoveTo = false
            )
            arcTo(
                rect = Rect(Offset(s * 0.28f, s * 0.2f), Size(s * 0.44f, s * 0.44f)),
                startAngleDegrees = 200f,
                sweepAngleDegrees = 140f,
                forceMoveTo = false
            )
            arcTo(
                rect = Rect(Offset(s * 0.51f, s * 0.32f), Size(s * 0.32f, s * 0.32f)),
                startAngleDegrees = 270f,
                sweepAngleDegrees = 90f,
                forceMoveTo = false
            )
            lineTo(s * 0.85f, s * 0.55f)
            lineTo(s * 0.15f, s * 0.55f)
            close()
        }
        drawPath(path = outlinePath, color = cloudStroke, style = Stroke(width = s * 0.025f))
    }
}

// ==================== 爱心图标（彩蛋用） ====================

@Composable
fun HeartIcon(size: Dp = 24.dp, tint: Color = FavoriteRed) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val path = Path().apply {
            moveTo(s * 0.5f, s * 0.85f)
            cubicTo(s * 0.1f, s * 0.6f, s * 0.0f, s * 0.3f, s * 0.25f, s * 0.2f)
            cubicTo(s * 0.4f, s * 0.12f, s * 0.5f, s * 0.25f, s * 0.5f, s * 0.35f)
            cubicTo(s * 0.5f, s * 0.25f, s * 0.6f, s * 0.12f, s * 0.75f, s * 0.2f)
            cubicTo(s * 1.0f, s * 0.3f, s * 0.9f, s * 0.6f, s * 0.5f, s * 0.85f)
            close()
        }
        drawPath(path = path, color = tint, style = Fill)
    }
}

@Composable
fun StarIcon(size: Dp = 24.dp, tint: Color = StarYellow) {
    Canvas(modifier = Modifier.size(size)) {
        val s = size.toPx()
        val center = Offset(s / 2, s / 2)
        val outerRadius = s * 0.45f
        val innerRadius = s * 0.18f
        val path = Path().apply {
            for (i in 0 until 5) {
                val outerAngle = Math.toRadians((i * 72.0 - 90.0))
                val ox = center.x + outerRadius * cos(outerAngle).toFloat()
                val oy = center.y + outerRadius * sin(outerAngle).toFloat()
                if (i == 0) moveTo(ox, oy) else lineTo(ox, oy)
                val innerAngle = Math.toRadians((i * 72.0 + 36.0 - 90.0))
                val ix = center.x + innerRadius * cos(innerAngle).toFloat()
                val iy = center.y + innerRadius * sin(innerAngle).toFloat()
                lineTo(ix, iy)
            }
            close()
        }
        drawPath(path = path, color = tint, style = Fill)
    }
}

// ==================== 获取天气/心情图标的工具函数 ====================

@Composable
fun WeatherIcon(weather: com.green.inorinal.data.Weather, size: Dp = 24.dp, tint: Color = DarkGrey) {
    when (weather) {
        com.green.inorinal.data.Weather.SUNNY -> WeatherSunnyIcon(size, tint)
        com.green.inorinal.data.Weather.RAINY -> WeatherRainyIcon(size, tint)
        com.green.inorinal.data.Weather.CLOUDY -> WeatherCloudyIcon(size, tint)
        com.green.inorinal.data.Weather.NIGHT_CLEAR -> WeatherNightClearIcon(size, tint)
        com.green.inorinal.data.Weather.SNOWY -> WeatherSnowyIcon(size, tint)
    }
}

@Composable
fun MoodIcon(mood: com.green.inorinal.data.Mood, size: Dp = 24.dp, tint: Color = DarkGrey) {
    when (mood) {
        com.green.inorinal.data.Mood.HAPPY -> MoodHappyIcon(size, tint)
        com.green.inorinal.data.Mood.CALM -> MoodCalmIcon(size, tint)
        com.green.inorinal.data.Mood.EXCITED -> MoodExcitedIcon(size, tint)
        com.green.inorinal.data.Mood.PROUD -> MoodProudIcon(size, tint)
        com.green.inorinal.data.Mood.EMOTIONAL -> MoodEmotionalIcon(size, tint)
        com.green.inorinal.data.Mood.SAD -> MoodSadIcon(size, tint)
    }
}
