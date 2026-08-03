package com.green.inorinal.ui.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.green.inorinal.data.AppColorStyle
import com.green.inorinal.data.AppThemeMode
import com.green.inorinal.data.Category
import com.green.inorinal.data.JournalViewModel
import com.green.inorinal.ui.layout.rememberAppWindowSize

@Composable
fun MainTabScreen(
    viewModel: JournalViewModel,
    colorStyle: AppColorStyle,
    themeMode: AppThemeMode,
    onColorStyleChange: (AppColorStyle) -> Unit,
    onThemeModeChange: (AppThemeMode) -> Unit,
    onEntryClick: (String) -> Unit,
    onNewEntry: () -> Unit,
    onSettingsClick: () -> Unit,
    onAboutClick: () -> Unit,
    onCategoryClick: (Category) -> Unit
) {
    var selectedTab by rememberSaveable { mutableStateOf(0) }
    val windowSize = rememberAppWindowSize()

    val tabs = listOf("首页", "分类", "收藏", "我的")
    val selectedIcons = listOf(
        Icons.Filled.Home,
        Icons.Filled.Dashboard,
        Icons.Filled.Favorite,
        Icons.Filled.Person
    )
    val unselectedIcons = listOf(
        Icons.Outlined.Home,
        Icons.Outlined.Dashboard,
        Icons.Outlined.FavoriteBorder,
        Icons.Outlined.Person
    )

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 3.dp
            ) {
                tabs.forEachIndexed { index, title ->
                    NavigationBarItem(
                        icon = {
                            Icon(
                                imageVector = if (selectedTab == index) selectedIcons[index] else unselectedIcons[index],
                                contentDescription = title
                            )
                        },
                        label = {
                            Text(
                                title,
                                fontSize = windowSize.navLabelSp.sp,
                                maxLines = 1
                            )
                        },
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
                        )
                    )
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { innerPadding ->
        when (selectedTab) {
            0 -> HomeScreen(
                viewModel = viewModel,
                onEntryClick = onEntryClick,
                onNewEntry = onNewEntry,
                modifier = Modifier.padding(innerPadding)
            )
            1 -> Box(Modifier.padding(innerPadding)) {
                CategoryScreen(
                    viewModel = viewModel,
                    onCategoryClick = onCategoryClick
                )
            }
            2 -> Box(Modifier.padding(innerPadding)) {
                FavoritesScreen(
                    viewModel = viewModel,
                    onEntryClick = onEntryClick
                )
            }
            3 -> Box(Modifier.padding(innerPadding)) {
                ProfileScreen(
                    viewModel = viewModel,
                    onSettingsClick = onSettingsClick,
                    onAboutClick = onAboutClick
                )
            }
        }
    }
}
