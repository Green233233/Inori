package com.green.inorinal.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.green.inorinal.data.Category
import com.green.inorinal.data.JournalEntry
import com.green.inorinal.ui.icons.MoodIcon
import com.green.inorinal.ui.layout.rememberAppWindowSize
import com.green.inorinal.ui.icons.WeatherIcon
import com.green.inorinal.util.htmlToPlainText

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun JournalCard(
    entry: JournalEntry,
    onClick: () -> Unit = {},
    onFavoriteClick: () -> Unit = {},
    onDeleteClick: (() -> Unit)? = null
) {
    var showMenu by remember { mutableStateOf(false) }
    val windowSize = rememberAppWindowSize()
    val preview = remember(entry.content) { htmlToPlainText(entry.content).trim() }
    val cardShape = androidx.compose.foundation.shape.RoundedCornerShape(windowSize.cardCorner)
    val themePrimary = MaterialTheme.colorScheme.primary
    val complementaryColor = Color(
        red = 1f - themePrimary.red,
        green = 1f - themePrimary.green,
        blue = 1f - themePrimary.blue,
        alpha = 1f
    )
    val cardGradient = Brush.radialGradient(
        colors = listOf(
            complementaryColor.copy(alpha = 0.10f),
            complementaryColor.copy(alpha = 0.045f),
            Color.Transparent
        ),
        radius = 560f
    )

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = windowSize.cardMinHeight)
            .combinedClickable(
                onClick = onClick,
                onLongClick = { showMenu = true }
            ),
        shape = cardShape,
        colors = CardDefaults.cardColors(
            containerColor = Color.Transparent
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.96f))
                .background(cardGradient)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = windowSize.cardInnerPaddingHorizontal,
                        top = windowSize.cardInnerPaddingVertical,
                        end = if (windowSize.isNarrow) 2.dp else 8.dp,
                        bottom = windowSize.cardInnerPaddingVertical
                    ),
                verticalAlignment = Alignment.CenterVertically
            ) {
                DateBlock(entry)
                Spacer(Modifier.width(windowSize.cardDateGap))

                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = entry.title.ifBlank { "未命名日记" },
                        style = if (windowSize.isNarrow) {
                            MaterialTheme.typography.titleSmall
                        } else {
                            MaterialTheme.typography.titleMedium
                        },
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = preview.ifBlank { "暂无正文" },
                        fontSize = if (windowSize.isNarrow) 12.sp else 13.sp,
                        lineHeight = if (windowSize.isNarrow) 16.sp else 18.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(
                            alpha = if (preview.isBlank()) 0.58f else 0.86f
                        ),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(Modifier.size(if (windowSize.isNarrow) 6.dp else 8.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(if (windowSize.isNarrow) 4.dp else 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StatusPill(compact = windowSize.isNarrow) {
                            WeatherIcon(
                                weather = entry.weather.normalized(),
                                size = if (windowSize.isNarrow) 13.dp else 15.dp,
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                        StatusPill(compact = windowSize.isNarrow) {
                            MoodIcon(
                                mood = entry.mood.normalized(),
                                size = if (windowSize.isNarrow) 13.dp else 15.dp,
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                        // Hide category label under ~340dp to keep the meta row from crowding.
                        if (!windowSize.isNarrow) {
                            categoryLabel(entry.category)?.let { label ->
                                StatusPill(compact = false) {
                                    Text(label, fontSize = 10.sp, maxLines = 1)
                                }
                            }
                        }
                    }
                }

                Box {
                    IconButton(
                        onClick = { showMenu = true },
                        modifier = Modifier.size(windowSize.cardActionSize)
                    ) {
                        Icon(
                            imageVector = Icons.Filled.MoreVert,
                            contentDescription = "更多操作",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text(if (entry.isFavorite) "取消收藏" else "收藏") },
                            leadingIcon = {
                                Icon(
                                    imageVector = if (entry.isFavorite) {
                                        Icons.Filled.Favorite
                                    } else {
                                        Icons.Filled.FavoriteBorder
                                    },
                                    contentDescription = null
                                )
                            },
                            onClick = {
                                showMenu = false
                                onFavoriteClick()
                            }
                        )
                        if (onDeleteClick != null) {
                            DropdownMenuItem(
                                text = {
                                    Text("删除", color = MaterialTheme.colorScheme.error)
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Filled.Delete,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.error
                                    )
                                },
                                onClick = {
                                    showMenu = false
                                    onDeleteClick()
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DateBlock(entry: JournalEntry) {
    val windowSize = rememberAppWindowSize()
    Column(
        modifier = Modifier.width(windowSize.cardDateWidth),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = entry.date.dayOfMonth.toString(),
            fontSize = windowSize.cardDateFontSp.sp,
            lineHeight = windowSize.cardDateFontSp.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1
        )
        Text(
            text = "${entry.date.monthValue}月",
            fontSize = if (windowSize.isNarrow) 11.sp else 12.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1
        )
    }
}

@Composable
private fun StatusPill(compact: Boolean, content: @Composable RowScope.() -> Unit) {
    Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.09f),
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant
    ) {
        Row(
            modifier = Modifier.padding(
                horizontal = if (compact) 5.dp else 7.dp,
                vertical = if (compact) 2.dp else 3.dp
            ),
            verticalAlignment = Alignment.CenterVertically,
            content = content
        )
    }
}

private fun categoryLabel(category: Category): String? = when (category) {
    Category.DAILY -> "日常"
    Category.WORK -> "工作"
    Category.GOAL -> "目标"
    Category.INSPIRATION -> "灵感"
    Category.EMOTION -> "情绪"
    Category.ALL -> null
}
