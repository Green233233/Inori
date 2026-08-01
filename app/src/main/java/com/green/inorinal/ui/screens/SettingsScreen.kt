package com.green.inorinal.ui.screens

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.green.inorinal.data.AppColorStyle
import com.green.inorinal.data.AppThemeMode
import com.green.inorinal.debug.DebugLog

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    colorStyle: AppColorStyle,
    themeMode: AppThemeMode,
    fontSizeSp: Int,
    debugMode: Boolean,
    onColorStyleChange: (AppColorStyle) -> Unit,
    onThemeModeChange: (AppThemeMode) -> Unit,
    onFontSizeChange: (Int) -> Unit,
    onDebugModeChange: (Boolean) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var showFontPicker by remember { mutableStateOf(false) }
    var showClearCacheDialog by remember { mutableStateOf(false) }
    var showDebugConfirmDialog by remember { mutableStateOf(false) }

    // 开启调试模式二次确认对话框
    if (showDebugConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showDebugConfirmDialog = false },
            title = { Text("开启调试模式") },
            text = {
                Text(
                    "开启后应用会自动记录运行日志，可能会降低运行速度并增大应用所占磁盘空间。" +
                        "日志只记录技术事件和脱敏后的崩溃堆栈，不记录日记标题、正文或搜索内容；" +
                        "单个日志文件最大 2 MB，最多保留 7 天。日志会保存到应用专属目录。" +
                        "是否继续？"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onDebugModeChange(true)
                    showDebugConfirmDialog = false
                    val path = DebugLog.logDirectoryPath()
                    Toast.makeText(
                        context,
                        if (path != null) "调试模式已开启，日志保存于：$path" else "调试模式已开启",
                        Toast.LENGTH_LONG
                    ).show()
                }) { Text("继续") }
            },
            dismissButton = {
                TextButton(onClick = { showDebugConfirmDialog = false }) { Text("取消") }
            }
        )
    }

    // 字体大小选择对话框
    if (showFontPicker) {
        val fontSizes = listOf("小" to 14, "中" to 16, "大" to 18, "特大" to 20)
        var selectedSize by remember(fontSizeSp) { mutableIntStateOf(fontSizeSp) }
        AlertDialog(
            onDismissRequest = { showFontPicker = false },
            title = { Text("字体大小") },
            text = {
                Column {
                    fontSizes.forEach { (label, size) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { selectedSize = size }
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = selectedSize == size,
                                onClick = { selectedSize = size }
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(label, fontSize = size.sp)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    onFontSizeChange(selectedSize)
                    Toast.makeText(context, "字体大小已设置为${selectedSize}sp", Toast.LENGTH_SHORT).show()
                    showFontPicker = false
                }) { Text("确定") }
            },
            dismissButton = {
                TextButton(onClick = { showFontPicker = false }) { Text("取消") }
            }
        )
    }

    // 清除缓存确认对话框
    if (showClearCacheDialog) {
        AlertDialog(
            onDismissRequest = { showClearCacheDialog = false },
            title = { Text("清除缓存") },
            text = { Text("确定要清除应用缓存吗？这不会删除你的日记数据。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        try {
                            val cacheDir = context.cacheDir
                            cacheDir?.deleteRecursively()
                            Toast.makeText(context, "缓存已清除", Toast.LENGTH_SHORT).show()
                        } catch (e: Exception) {
                            Toast.makeText(context, "清除失败: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                        showClearCacheDialog = false
                    }
                ) { Text("清除") }
            },
            dismissButton = {
                TextButton(onClick = { showClearCacheDialog = false }) { Text("取消") }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                },
                title = {
                    Text(
                        "设置",
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            // 界面设置
            SectionHeader("界面设置")

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Column {
                    ColorStyleSelector(colorStyle, onColorStyleChange)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    ThemeModeSelector(themeMode, onThemeModeChange)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    SettingItem("字体大小") { showFontPicker = true }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    SettingItem("卡片样式") {
                        Toast.makeText(context, "卡片样式功能即将上线", Toast.LENGTH_SHORT).show()
                    }
                }
            }

            Spacer(Modifier.height(24.dp))

            // 编辑设置
            SectionHeader("编辑设置")

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Column {
                    SettingItem("默认字体") {
                        Toast.makeText(context, "默认字体功能即将上线", Toast.LENGTH_SHORT).show()
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    SettingItem("默认笔刷") {
                        Toast.makeText(context, "默认笔刷功能即将上线", Toast.LENGTH_SHORT).show()
                    }
                }
            }

            Spacer(Modifier.height(24.dp))

            // 隐私设置
            SectionHeader("隐私设置")

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Column {
                    SettingItem("应用锁") {
                        Toast.makeText(context, "应用锁功能即将上线，敬请期待", Toast.LENGTH_SHORT).show()
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    SettingItem("隐藏敏感内容") {
                        Toast.makeText(context, "隐藏敏感内容功能即将上线", Toast.LENGTH_SHORT).show()
                    }
                }
            }

            Spacer(Modifier.height(24.dp))

            // 开发者
            SectionHeader("开发者")

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Column {
                    SettingSwitchItem(
                        title = "调试模式",
                        subtitle = "自动记录日志，便于开发与调试",
                        checked = debugMode,
                        onCheckedChange = { checked ->
                            if (checked) {
                                showDebugConfirmDialog = true
                            } else {
                                onDebugModeChange(false)
                                Toast.makeText(context, "调试模式已关闭，已有日志将被删除", Toast.LENGTH_SHORT).show()
                            }
                        }
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    SettingItem("删除调试日志") {
                        DebugLog.clearLogs()
                        Toast.makeText(context, "调试日志已删除", Toast.LENGTH_SHORT).show()
                    }
                }
            }

            Spacer(Modifier.height(24.dp))

            // 其他
            SectionHeader("其他")

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Column {
                    SettingItem("清除缓存") { showClearCacheDialog = true }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        fontSize = 14.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, bottom = 8.dp)
    )
}

@Composable
private fun SettingItem(title: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = title,
            fontSize = 16.sp,
            color = MaterialTheme.colorScheme.onSurface
        )
        Text(
            text = "›",
            fontSize = 20.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun SettingSwitchItem(
    title: String,
    subtitle: String? = null,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange
        )
    }
}

@Composable
private fun ColorStyleSelector(currentStyle: AppColorStyle, onStyleChange: (AppColorStyle) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = true }
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "颜色风格",
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = currentStyle.displayName,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.width(4.dp))
                Text(text = "›", fontSize = 20.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 16.dp, end = 16.dp)
        ) {
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
                properties = PopupProperties(focusable = true)
            ) {
                AppColorStyle.entries.forEach { style ->
                    DropdownMenuItem(
                        text = { Text(style.displayName) },
                        onClick = {
                            onStyleChange(style)
                            expanded = false
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ThemeModeSelector(currentMode: AppThemeMode, onModeChange: (AppThemeMode) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = true }
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "主题模式",
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = currentMode.displayName,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.width(4.dp))
                Text(text = "›", fontSize = 20.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 16.dp, end = 16.dp)
        ) {
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
                properties = PopupProperties(focusable = true)
            ) {
                AppThemeMode.entries.forEach { mode ->
                    DropdownMenuItem(
                        text = { Text(mode.displayName) },
                        onClick = {
                            onModeChange(mode)
                            expanded = false
                        }
                    )
                }
            }
        }
    }
}
