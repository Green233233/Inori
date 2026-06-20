package com.green.inorinal.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.green.inorinal.data.Category
import com.green.inorinal.data.JournalEntry
import com.green.inorinal.data.JournalViewModel
import com.green.inorinal.ui.components.JournalCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoryEntriesScreen(
    viewModel: JournalViewModel,
    category: Category,
    onEntryClick: (String) -> Unit,
    onBack: () -> Unit
) {
    val entries by viewModel.allEntries.collectAsState()
    val filteredEntries = if (category == Category.ALL) entries else entries.filter { it.category == category }
    var entryToDelete by remember { mutableStateOf<JournalEntry?>(null) }

    // 删除确认对话框
    if (entryToDelete != null) {
        AlertDialog(
            onDismissRequest = { entryToDelete = null },
            title = { Text("删除日记") },
            text = { Text("确定要删除「${entryToDelete!!.title}」吗？此操作不可撤销。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.deleteEntry(entryToDelete!!)
                        entryToDelete = null
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { entryToDelete = null }) { Text("取消") }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when (category) {
                            Category.ALL -> "全部"
                            Category.DAILY -> "日常"
                            Category.WORK -> "工作"
                            Category.GOAL -> "目标"
                            Category.INSPIRATION -> "灵感"
                            Category.EMOTION -> "情绪"
                            else -> category.name
                        },
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { innerPadding ->
        if (filteredEntries.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    "该分类下暂无日记",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(vertical = 16.dp)
            ) {
                items(filteredEntries, key = { it.id }) { entry ->
                    JournalCard(
                        entry = entry,
                        onClick = { onEntryClick(entry.id) },
                        onFavoriteClick = { viewModel.toggleFavorite(entry) },
                        onDeleteClick = { entryToDelete = entry }
                    )
                }
            }
        }
    }
}
