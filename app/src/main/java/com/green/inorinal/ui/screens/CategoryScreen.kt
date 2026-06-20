package com.green.inorinal.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.green.inorinal.data.Category
import com.green.inorinal.data.JournalViewModel

data class CategoryItem(
    val category: Category,
    val label: String,
    val icon: ImageVector,
    val count: Int = 0
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoryScreen(
    viewModel: JournalViewModel,
    onCategoryClick: (Category) -> Unit
) {
    val allEntries by viewModel.allEntries.collectAsState()
    val entriesLoaded by viewModel.entriesLoaded.collectAsState()
    val categoryCounts = allEntries.groupingBy { it.category }.eachCount()

    val categories = listOf(
        CategoryItem(Category.ALL, "全部", Icons.AutoMirrored.Filled.MenuBook, allEntries.size),
        CategoryItem(Category.DAILY, "日常", Icons.Filled.WbSunny, categoryCounts[Category.DAILY] ?: 0),
        CategoryItem(Category.WORK, "工作", Icons.Filled.Work, categoryCounts[Category.WORK] ?: 0),
        CategoryItem(Category.GOAL, "目标", Icons.Filled.TrackChanges, categoryCounts[Category.GOAL] ?: 0),
        CategoryItem(Category.INSPIRATION, "灵感", Icons.Filled.Lightbulb, categoryCounts[Category.INSPIRATION] ?: 0),
        CategoryItem(Category.EMOTION, "情感", Icons.Filled.Favorite, categoryCounts[Category.EMOTION] ?: 0)
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "分类",
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(vertical = 8.dp)
        ) {
            items(categories) { item ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onCategoryClick(item.category) }
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = item.icon,
                                contentDescription = item.label,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp)
                            )
                            Spacer(Modifier.width(12.dp))
                            Text(
                                text = item.label,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = if (entriesLoaded) "${item.count} 篇" else "加载中",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(Modifier.width(4.dp))
                            Icon(
                                imageVector = Icons.Filled.ChevronRight,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}
