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
    val preview = remember(entry.content) { htmlToPlainText(entry.content).trim() }
    val cardShape = androidx.compose.foundation.shape.RoundedCornerShape(18.dp)
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
            .defaultMinSize(minHeight = 104.dp)
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
                    .padding(start = 16.dp, top = 14.dp, end = 8.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                DateBlock(entry)
                Spacer(Modifier.width(14.dp))

                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = entry.title.ifBlank { "未命名日记" },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = preview.ifBlank { "暂无正文" },
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(
                            alpha = if (preview.isBlank()) 0.58f else 0.86f
                        ),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(Modifier.size(8.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StatusPill {
                            WeatherIcon(
                                weather = entry.weather.normalized(),
                                size = 15.dp,
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                        StatusPill {
                            MoodIcon(
                                mood = entry.mood.normalized(),
                                size = 15.dp,
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                        categoryLabel(entry.category)?.let { label ->
                            StatusPill { Text(label, fontSize = 10.sp) }
                        }
                    }
                }

                Box {
                    IconButton(onClick = { showMenu = true }) {
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
    Column(
        modifier = Modifier.width(52.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = entry.date.dayOfMonth.toString(),
            fontSize = 34.sp,
            lineHeight = 34.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface
        )
        Text(
            text = "${entry.date.monthValue}月",
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun StatusPill(content: @Composable RowScope.() -> Unit) {
    Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.09f),
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
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
