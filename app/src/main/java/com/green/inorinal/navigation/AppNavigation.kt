package com.green.inorinal.navigation

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.green.inorinal.data.AppColorStyle
import com.green.inorinal.data.AppThemeMode
import com.green.inorinal.data.Category
import com.green.inorinal.data.JournalViewModel
import com.green.inorinal.ui.screens.*

@Composable
fun AppNavigation(
    colorStyle: AppColorStyle,
    themeMode: AppThemeMode,
    fontSizeSp: Int,
    debugMode: Boolean,
    onColorStyleChange: (AppColorStyle) -> Unit,
    onThemeModeChange: (AppThemeMode) -> Unit,
    onFontSizeChange: (Int) -> Unit,
    onDebugModeChange: (Boolean) -> Unit
) {
    val navController = rememberNavController()
    val viewModel: JournalViewModel = viewModel()

    NavHost(
        navController = navController,
        startDestination = "main"
    ) {
        // 主界面（包含底部导航的首页、分类、收藏、我的）
        composable("main") {
            MainTabScreen(
                viewModel = viewModel,
                colorStyle = colorStyle,
                themeMode = themeMode,
                onColorStyleChange = onColorStyleChange,
                onThemeModeChange = onThemeModeChange,
                onEntryClick = { entryId ->
                    navController.navigate("editor/$entryId")
                },
                onNewEntry = {
                    navController.navigate("editor/new")
                },
                onSettingsClick = {
                    navController.navigate("settings")
                },
                onAboutClick = {
                    navController.navigate("about")
                },
                onCategoryClick = { category ->
                    navController.navigate("category/${category.name}")
                }
            )
        }

        // 编辑器
        composable(
            route = "editor/{entryId}",
            arguments = listOf(navArgument("entryId") { type = NavType.StringType })
        ) { backStackEntry ->
            val entryId = backStackEntry.arguments?.getString("entryId")
            EditorScreen(
                viewModel = viewModel,
                entryId = if (entryId == "new") null else entryId,
                fontSizeSp = fontSizeSp,
                onBack = { navController.popBackStack() }
            )
        }

        // 设置
        composable("settings") {
            SettingsScreen(
                colorStyle = colorStyle,
                themeMode = themeMode,
                fontSizeSp = fontSizeSp,
                debugMode = debugMode,
                onColorStyleChange = onColorStyleChange,
                onThemeModeChange = onThemeModeChange,
                onFontSizeChange = onFontSizeChange,
                onDebugModeChange = onDebugModeChange,
                onBack = { navController.popBackStack() }
            )
        }

        // 关于
        composable("about") {
            AboutScreen(
                onBack = { navController.popBackStack() }
            )
        }

        // 分类日记列表
        composable(
            route = "category/{category}",
            arguments = listOf(navArgument("category") { type = NavType.StringType })
        ) { backStackEntry ->
            val categoryName = backStackEntry.arguments?.getString("category") ?: "ALL"
            val category = try { Category.valueOf(categoryName) } catch (_: Exception) { Category.ALL }
            CategoryEntriesScreen(
                viewModel = viewModel,
                category = category,
                onEntryClick = { entryId ->
                    navController.navigate("editor/$entryId")
                },
                onBack = { navController.popBackStack() }
            )
        }
    }
}
