package com.green.inorinal.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.green.inorinal.data.Category
import com.green.inorinal.data.JournalEntry
import com.green.inorinal.ui.icons.MoodIcon
import com.green.inorinal.ui.icons.WeatherIcon
import com.green.inorinal.util.htmlToPlainText
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun JournalCard(
    entry: JournalEntry,
    onClick: () -> Unit = {},
    onFavoriteClick: () -> Unit = {},
    onDeleteClick: (() -> Unit)? = null
) {
    val dateFormatter = DateTimeFormatter.ofPattern("M月d日 EEEE")
    var showContextMenu by remember { mutableStateOf(false) }
    var cardHeightPx by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val menuHeight = 48.dp

    Box(modifier = Modifier.fillMaxWidth()) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .onGloballyPositioned { cardHeightPx = it.size.height }
                .combinedClickable(
                    onClick = onClick,
                    onLongClick = { showContextMenu = true }
                ),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.06f),
                            MaterialTheme.colorScheme.surfaceVariant
                        )
                    )
                )
                .padding(16.dp)
        ) {
            // 日期、天气和操作行
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = entry.date.format(dateFormatter),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    WeatherIcon(entry.weather, size = 16.dp, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(8.dp))
                    MoodIcon(entry.mood, size = 16.dp, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    // 收藏按钮 - 始终可见
                    Spacer(Modifier.width(4.dp))
                    IconButton(
                        onClick = onFavoriteClick,
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            imageVector = if (entry.isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                            contentDescription = if (entry.isFavorite) "取消收藏" else "收藏",
                            modifier = Modifier.size(16.dp),
                            tint = if (entry.isFavorite) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            // 标题
            Text(
                text = entry.title,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(Modifier.height(6.dp))

            // 分类标签
            val categoryLabel = when (entry.category) {
                Category.DAILY -> "日常"
                Category.WORK -> "工作"
                Category.GOAL -> "目标"
                Category.INSPIRATION -> "灵感"
                Category.EMOTION -> "情绪"
                else -> null
            }
            if (categoryLabel != null) {
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                    modifier = Modifier.padding(bottom = 6.dp)
                ) {
                    Text(
                        text = categoryLabel,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }

            // 内容预览
            if (entry.content.isNotBlank()) {
                val plainText = htmlToPlainText(entry.content)
                if (plainText.isNotBlank()) {
                    Text(
                        text = plainText,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                        lineHeight = 20.sp
                    )
                }
            }
        }
        }

        if (showContextMenu && onDeleteClick != null) {
            DropdownMenu(
                expanded = showContextMenu,
                onDismissRequest = { showContextMenu = false },
                offset = with(density) {
                    DpOffset(0.dp, (-cardHeightPx.toDp() - menuHeight - 4.dp))
                },
                properties = PopupProperties(focusable = true)
            ) {
                DropdownMenuItem(
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Filled.Delete,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("删除日记", color = MaterialTheme.colorScheme.error)
                        }
                    },
                    onClick = {
                        showContextMenu = false
                        onDeleteClick()
                    }
                )
            }
        }
    }
}
