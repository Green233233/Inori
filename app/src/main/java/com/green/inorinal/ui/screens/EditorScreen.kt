package com.green.inorinal.ui.screens

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import android.graphics.BitmapFactory
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.zIndex
import androidx.activity.compose.BackHandler
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import android.util.Base64
import android.widget.ImageView
import com.green.inorinal.data.*
import com.green.inorinal.debug.DebugLog
import com.green.inorinal.editor.EditorBridge
import com.green.inorinal.ui.icons.WeatherIcon
import com.green.inorinal.ui.icons.MoodIcon
import com.green.inorinal.ui.layout.rememberAppWindowSize
import com.green.inorinal.ui.theme.*
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.LocalDate
import java.util.Locale
import java.util.UUID

private data class EditorSaveSnapshot(
    val title: String,
    val content: String,
    val weather: Weather,
    val mood: Mood,
    val category: Category
)

/** True when HTML has no meaningful text, images, stickers, or doodle data. */
private fun isBlankEditorHtml(html: String): Boolean {
    if (html.isBlank()) return true
    val lower = html.lowercase(Locale.ROOT)
    if ("journal-sticker" in lower) return false
    if ("<img" in lower) return false
    if ("doodle-data" in lower) return false
    if ("journal-media://" in lower) return false
    val stripped = html
        .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "")
        .replace(Regex("&nbsp;", RegexOption.IGNORE_CASE), " ")
        .replace(Regex("<[^>]+>"), "")
        .replace("\u200B", "")
        .trim()
    return stripped.isEmpty()
}

private data class StickerOption(
    val name: String,
    val emoji: String
)

private data class BrushSizeRange(
    val min: Float,
    val max: Float,
    val default: Float
)

@OptIn(ExperimentalMaterial3Api::class, FlowPreview::class, ExperimentalLayoutApi::class)
@Composable
fun EditorScreen(
    viewModel: JournalViewModel,
    entryId: String?,
    fontSizeSp: Int,
    themeMode: AppThemeMode,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val windowSize = rememberAppWindowSize()
    val bridge = remember { EditorBridge(context) }
    val scope = rememberCoroutineScope()
    var entry by remember { mutableStateOf<JournalEntry?>(null) }
    var showMetaMenu by remember { mutableStateOf(false) }
    var selectedWeather by remember { mutableStateOf(Weather.SUNNY) }
    var selectedMood by remember { mutableStateOf(Mood.HAPPY) }
    var selectedCategory by remember { mutableStateOf(Category.DAILY) }
    var showWeatherPicker by remember { mutableStateOf(false) }
    var showMoodPicker by remember { mutableStateOf(false) }
    var showCategoryPicker by remember { mutableStateOf(false) }
    var currentToolbar by remember { mutableStateOf("none") }
    var title by remember { mutableStateOf("") }
    var isSaving by remember { mutableStateOf(false) }
    var webViewCreated by remember { mutableStateOf(false) }
    var previewImageDataUrl by remember { mutableStateOf<String?>(null) }
    var hasLoadedEntry by remember { mutableStateOf(entryId == null) }
    var lastSavedSnapshot by remember { mutableStateOf<EditorSaveSnapshot?>(null) }
    var showEmptyOverwriteDialog by remember { mutableStateOf(false) }
    var pendingEmptyExitContent by remember { mutableStateOf<String?>(null) }
    val saveMutex = remember { Mutex() }

    fun protectedContent(): String =
        lastSavedSnapshot?.content ?: entry?.content.orEmpty()

    fun wouldEmptyOverwrite(content: String): Boolean =
        isBlankEditorHtml(content) && !isBlankEditorHtml(protectedContent())

    // 加载现有日记
    LaunchedEffect(entryId) {
        hasLoadedEntry = entryId == null
        if (entryId != null) {
            val loaded = viewModel.getEntryById(entryId)
            if (loaded != null) {
                entry = loaded
                bridge.currentEntryId = loaded.id
                title = loaded.title
                selectedWeather = loaded.weather.normalized()
                selectedMood = loaded.mood.normalized()
                selectedCategory = loaded.category
                // 关键修复：使用 setPendingContent 而非直接 setContent
                // 这确保内容在 WebView 页面加载完成后才被设置
                bridge.setPendingContent(loaded.content)
                lastSavedSnapshot = EditorSaveSnapshot(
                    title = loaded.title,
                    content = loaded.content,
                    weather = loaded.weather.normalized(),
                    mood = loaded.mood.normalized(),
                    category = loaded.category
                )
            } else {
                Toast.makeText(context, "该日记不存在或已被删除", Toast.LENGTH_SHORT).show()
                onBack()
                return@LaunchedEffect
            }
        }
        hasLoadedEntry = true
    }

    // 当 JS 中的图片被点击时，显示预览对话框
    bridge.onImageClick = { dataUrl ->
        previewImageDataUrl = dataUrl
    }

    bridge.onImageInsertFailed = {
        Toast.makeText(context, "图片插入失败，请重试", Toast.LENGTH_SHORT).show()
    }

    fun createDraftEntry(): JournalEntry {
        val now = LocalDate.now()
        val dayOfWeek = when (now.dayOfWeek.value) {
            1 -> "星期一"; 2 -> "星期二"; 3 -> "星期三"
            4 -> "星期四"; 5 -> "星期五"; 6 -> "星期六"; 7 -> "星期日"; else -> ""
        }
        val defaultTitle = "${now.year}年${now.monthValue}月${now.dayOfMonth}日 $dayOfWeek"
        return JournalEntry(
            id = UUID.randomUUID().toString(),
            title = title.ifBlank { defaultTitle },
            content = "",
            date = now,
            weather = selectedWeather,
            mood = selectedMood,
            category = selectedCategory
        )
    }

    // 图片选择器
    val imageLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            val targetEntry = entry ?: createDraftEntry().also { draft -> entry = draft }
            bridge.currentEntryId = targetEntry.id
            bridge.insertImage(it)
        }
    }

    bridge.onImageRequest = {
        imageLauncher.launch("image/*")
    }

    fun hasMeaningfulChanges(content: String): Boolean {
        return title.isNotBlank() ||
            content.isNotBlank() ||
            selectedWeather != Weather.SUNNY ||
            selectedMood != Mood.HAPPY ||
            selectedCategory != Category.DAILY
    }

    // 即时保存日记
    suspend fun saveEntry(
        content: String = bridge.getCurrentContent(),
        allowEmptyOverwrite: Boolean = false
    ): Boolean {
        return saveMutex.withLock {
            if (!hasLoadedEntry) {
                return@withLock true
            }
            val currentEntry = entry
            if (currentEntry == null && !hasMeaningfulChanges(content)) {
                return@withLock true
            }

            // Autosave / background save must never wipe a non-empty entry with blank HTML.
            if (!allowEmptyOverwrite && wouldEmptyOverwrite(content)) {
                return@withLock true
            }

            val baseEntry = currentEntry ?: createDraftEntry()
            bridge.currentEntryId = baseEntry.id
            val snapshot = EditorSaveSnapshot(
                title = title.ifBlank { baseEntry.title },
                content = content,
                weather = selectedWeather,
                mood = selectedMood,
                category = selectedCategory
            )
            if (lastSavedSnapshot == snapshot) {
                return@withLock true
            }

            try {
                val savedEntry = viewModel.saveEntry(
                    baseEntry.copy(
                        title = snapshot.title,
                        content = snapshot.content,
                        weather = snapshot.weather,
                        mood = snapshot.mood,
                        category = snapshot.category
                    ),
                    refreshStatistics = currentEntry == null
                )
                entry = savedEntry
                bridge.currentEntryId = savedEntry.id
                // Compare against display HTML (data URIs). DB may store journal-media:// refs.
                val displayContent = bridge.toDisplayableHtml(savedEntry.content)
                lastSavedSnapshot = snapshot.copy(content = displayContent)
                if (displayContent != snapshot.content) {
                    bridge.setContent(savedEntry.content)
                }
                true
            } catch (_: Exception) {
                DebugLog.event(DebugLog.AppEvent.JOURNAL_SAVE_FAILED)
                false
            }
        }
    }

    suspend fun saveLatestContent(): Boolean {
        return saveEntry(bridge.getContentForSave(), allowEmptyOverwrite = false)
    }

    suspend fun forceRestoreProtectedEntry(): Boolean {
        return saveMutex.withLock {
            val currentEntry = entry ?: return@withLock true
            val snap = lastSavedSnapshot
            val restoreContent = snap?.content ?: currentEntry.content
            if (isBlankEditorHtml(restoreContent)) {
                return@withLock true
            }
            try {
                val restored = viewModel.saveEntry(
                    currentEntry.copy(
                        title = snap?.title ?: title.ifBlank { currentEntry.title },
                        content = restoreContent,
                        weather = snap?.weather ?: selectedWeather,
                        mood = snap?.mood ?: selectedMood,
                        category = snap?.category ?: selectedCategory
                    )
                )
                entry = restored
                bridge.currentEntryId = restored.id
                val displayContent = bridge.toDisplayableHtml(restored.content)
                lastSavedSnapshot = EditorSaveSnapshot(
                    title = restored.title,
                    content = displayContent,
                    weather = restored.weather.normalized(),
                    mood = restored.mood.normalized(),
                    category = restored.category
                )
                true
            } catch (_: Exception) {
                DebugLog.event(DebugLog.AppEvent.JOURNAL_SAVE_FAILED)
                false
            }
        }
    }

    fun saveAndExit() {
        if (isSaving || showEmptyOverwriteDialog) return
        scope.launch {
            val content = bridge.getContentForSave()
            if (wouldEmptyOverwrite(content)) {
                pendingEmptyExitContent = content
                showEmptyOverwriteDialog = true
                return@launch
            }
            isSaving = true
            if (saveEntry(content, allowEmptyOverwrite = false)) {
                onBack()
            } else {
                isSaving = false
                Toast.makeText(context, "保存失败，请检查存储空间后重试", Toast.LENGTH_LONG).show()
            }
        }
    }

    fun confirmEmptyOverwriteAndExit() {
        if (isSaving) return
        isSaving = true
        showEmptyOverwriteDialog = false
        scope.launch {
            val content = pendingEmptyExitContent ?: ""
            pendingEmptyExitContent = null
            if (saveEntry(content, allowEmptyOverwrite = true)) {
                onBack()
            } else {
                isSaving = false
                Toast.makeText(context, "保存失败，请检查存储空间后重试", Toast.LENGTH_LONG).show()
            }
        }
    }

    fun cancelEmptyOverwriteAndExit() {
        if (isSaving) return
        isSaving = true
        showEmptyOverwriteDialog = false
        pendingEmptyExitContent = null
        scope.launch {
            if (!forceRestoreProtectedEntry()) {
                isSaving = false
                Toast.makeText(context, "恢复手账失败，请重试", Toast.LENGTH_LONG).show()
                return@launch
            }
            onBack()
        }
    }

    LaunchedEffect(Unit) {
        bridge.content.debounce(350).collectLatest {
            saveLatestContent()
        }
    }

    LaunchedEffect(title, selectedWeather, selectedMood, selectedCategory, hasLoadedEntry) {
        delay(350)
        saveLatestContent()
    }

    LaunchedEffect(fontSizeSp) {
        bridge.applyEditorSettings(fontSizeSp)
    }

    // 处理系统返回按钮：保存并返回
    BackHandler(enabled = !showEmptyOverwriteDialog && !isSaving) {
        saveAndExit()
    }

    if (showEmptyOverwriteDialog) {
        AlertDialog(
            onDismissRequest = { cancelEmptyOverwriteAndExit() },
            title = { Text("即将覆盖为空内容") },
            text = {
                Text(
                    "检测到整篇手账即将被覆盖为空内容，如果您没有这么做，很抱歉应用可能在保存手账时出现了问题。" +
                        "如果点按继续保存按钮，手账将会被空内容覆盖。点按取消按钮，则应用将保护本手账条目内容，不保存即退出。" +
                        "如果清空手账不是您的意图，请点击“取消”。"
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmEmptyOverwriteAndExit() }) {
                    Text("继续保存", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { cancelEmptyOverwriteAndExit() }) {
                    Text("取消")
                }
            }
        )
    }

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .imePadding(),
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = ::saveAndExit, enabled = !isSaving) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回并保存",
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                },
                title = {
                    BasicTextField(
                        value = title,
                        onValueChange = { title = it },
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = if (windowSize.isCompact) 16.sp else 18.sp
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(end = 4.dp),
                        decorationBox = { innerTextField ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 8.dp),
                                contentAlignment = Alignment.CenterStart
                            ) {
                                if (title.isBlank()) {
                                    Text(
                                        "标题",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.68f),
                                        fontWeight = FontWeight.Bold,
                                        fontSize = if (windowSize.isCompact) 16.sp else 18.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                innerTextField()
                            }
                        }
                    )
                },
                actions = {
                    // Collapse weather / mood / category into one action to keep title usable at ~300dp.
                    Box {
                        IconButton(onClick = {
                            showMetaMenu = true
                            currentToolbar = "none"
                            bridge.toggleDoodleMode(false)
                        }) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(2.dp),
                                modifier = Modifier.padding(horizontal = 2.dp)
                            ) {
                                WeatherIcon(selectedWeather, size = 18.dp, tint = MaterialTheme.colorScheme.primary)
                                MoodIcon(selectedMood, size = 18.dp, tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                        DropdownMenu(
                            expanded = showMetaMenu,
                            onDismissRequest = { showMetaMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("天气：${selectedWeather.displayName}") },
                                leadingIcon = {
                                    WeatherIcon(selectedWeather, size = 18.dp, tint = MaterialTheme.colorScheme.primary)
                                },
                                onClick = {
                                    showMetaMenu = false
                                    showWeatherPicker = true
                                    showMoodPicker = false
                                    showCategoryPicker = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("心情：${selectedMood.displayName}") },
                                leadingIcon = {
                                    MoodIcon(selectedMood, size = 18.dp, tint = MaterialTheme.colorScheme.primary)
                                },
                                onClick = {
                                    showMetaMenu = false
                                    showMoodPicker = true
                                    showWeatherPicker = false
                                    showCategoryPicker = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("分类") },
                                leadingIcon = {
                                    Icon(
                                        Icons.Filled.Dashboard,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    showMetaMenu = false
                                    showCategoryPicker = true
                                    showWeatherPicker = false
                                    showMoodPicker = false
                                }
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 4.dp,
                shadowElevation = 10.dp
            ) {
                // 底栏只保留固定高度的主工具，扩展面板使用覆盖式底部弹层。
                NavigationBar(
                    containerColor = Color.Transparent,
                    tonalElevation = 0.dp
                ) {
                    NavigationBarItem(
                        icon = { Icon(Icons.Filled.TextFields, contentDescription = "文字") },
                        label = { Text("文字", fontSize = 10.sp) },
                        selected = currentToolbar == "text",
                        onClick = {
                            currentToolbar = if (currentToolbar == "text") "none" else "text"
                            showWeatherPicker = false
                            showMoodPicker = false
                            showCategoryPicker = false
                            if (currentToolbar != "doodle") bridge.toggleDoodleMode(false)
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                        )
                    )
                    NavigationBarItem(
                        icon = { Icon(Icons.Filled.Brush, contentDescription = "涂鸦") },
                        label = { Text("涂鸦", fontSize = 10.sp) },
                        selected = currentToolbar == "doodle",
                        onClick = {
                            currentToolbar = if (currentToolbar == "doodle") "none" else "doodle"
                            showWeatherPicker = false
                            showMoodPicker = false
                            showCategoryPicker = false
                            bridge.toggleDoodleMode(currentToolbar == "doodle")
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                        )
                    )
                    NavigationBarItem(
                        icon = { Icon(Icons.Filled.AddPhotoAlternate, contentDescription = "照片") },
                        label = { Text("照片", fontSize = 10.sp) },
                        selected = false,
                        onClick = { imageLauncher.launch("image/*") },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                        )
                    )
                    NavigationBarItem(
                        icon = { Icon(Icons.Filled.AutoAwesome, contentDescription = "贴纸") },
                        label = { Text("贴纸", fontSize = 10.sp) },
                        selected = currentToolbar == "sticker",
                        onClick = {
                            currentToolbar = if (currentToolbar == "sticker") "none" else "sticker"
                            showWeatherPicker = false
                            showMoodPicker = false
                            showCategoryPicker = false
                            if (currentToolbar != "doodle") bridge.toggleDoodleMode(false)
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                        )
                    )
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { innerPadding ->
        // 获取当前主题颜色用于 WebView
        val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
        val isDark = when (themeMode) {
            AppThemeMode.LIGHT -> false
            AppThemeMode.DARK -> true
            AppThemeMode.SYSTEM -> systemDark
        }
        val bgColor = colorToHex(MaterialTheme.colorScheme.background)
        val textColor = colorToHex(MaterialTheme.colorScheme.onBackground)
        val paperBgStart = colorToHex(MaterialTheme.colorScheme.surface)
        val paperBgMid = colorToHex(MaterialTheme.colorScheme.surface)
        val paperBgEnd = colorToHex(MaterialTheme.colorScheme.surface)
        val lineColor = if (isDark) "rgba(255,255,255,0.05)" else "rgba(0,0,0,0.03)"

        Box(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize()
        ) {
            AndroidView(
                factory = { ctx ->
                    android.webkit.WebView(ctx).also { webView ->
                        webView.layoutParams = android.view.ViewGroup.LayoutParams(
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        webView.isFocusable = true
                        webView.isFocusableInTouchMode = true
                        webView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
                        bridge.setupWebView(webView)
                        webViewCreated = true
                    }
                },
                update = {
                    bridge.applyTheme(
                        isDark = isDark,
                        bgColor = bgColor,
                        textColor = textColor,
                        paperBgStart = paperBgStart,
                        paperBgMid = paperBgMid,
                        paperBgEnd = paperBgEnd,
                        lineColor = lineColor
                    )
                    bridge.applyEditorSettings(fontSizeSp)
                },
                modifier = Modifier
                    .matchParentSize()
                    .zIndex(0f)
            )

            AnimatedVisibility(
                visible = currentToolbar == "text",
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .zIndex(2f),
                enter = slideInVertically { it } + fadeIn(),
                exit = slideOutVertically { it } + fadeOut()
            ) {
                TextToolbarPanel(bridge = bridge, onHide = { currentToolbar = "none" })
            }
            AnimatedVisibility(
                visible = currentToolbar == "doodle",
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .zIndex(2f),
                enter = slideInVertically { it } + fadeIn(),
                exit = slideOutVertically { it } + fadeOut()
            ) {
                DoodleToolbarPanel(
                    bridge = bridge,
                    onHide = {
                        currentToolbar = "none"
                        bridge.toggleDoodleMode(false)
                    }
                )
            }
            AnimatedVisibility(
                visible = currentToolbar == "sticker",
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .zIndex(2f),
                enter = slideInVertically { it } + fadeIn(),
                exit = slideOutVertically { it } + fadeOut()
            ) {
                StickerPanel(bridge = bridge, onHide = { currentToolbar = "none" })
            }
        }
    }

    fun dismissEditorSheet() {
        showWeatherPicker = false
        showMoodPicker = false
        showCategoryPicker = false
        if (currentToolbar == "doodle") bridge.toggleDoodleMode(false)
        currentToolbar = "none"
    }

    when {
        showWeatherPicker -> ModalBottomSheet(
            onDismissRequest = ::dismissEditorSheet,
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = { BottomSheetDefaults.DragHandle() }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = windowSize.sheetHorizontalPadding, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("选择天气", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(16.dp))
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Weather.selectableEntries.forEach { weather ->
                        FilterChip(
                            selected = weather == selectedWeather,
                            onClick = {
                                selectedWeather = weather
                                dismissEditorSheet()
                            },
                            label = { Text(weather.displayName) },
                            leadingIcon = {
                                WeatherIcon(
                                    weather,
                                    size = 20.dp,
                                    tint = if (weather == selectedWeather) {
                                        MaterialTheme.colorScheme.onSecondaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    }
                                )
                            }
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }

        showMoodPicker -> ModalBottomSheet(
            onDismissRequest = ::dismissEditorSheet,
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = { BottomSheetDefaults.DragHandle() }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = windowSize.sheetHorizontalPadding, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("记录此刻心情", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(16.dp))
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Mood.selectableEntries.forEach { mood ->
                        FilterChip(
                            selected = mood == selectedMood,
                            onClick = {
                                selectedMood = mood
                                dismissEditorSheet()
                            },
                            label = { Text(mood.displayName) },
                            leadingIcon = {
                                MoodIcon(
                                    mood,
                                    size = 20.dp,
                                    tint = if (mood == selectedMood) {
                                        MaterialTheme.colorScheme.onSecondaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    }
                                )
                            }
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }

        showCategoryPicker -> ModalBottomSheet(
            onDismissRequest = ::dismissEditorSheet,
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = { BottomSheetDefaults.DragHandle() }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = windowSize.sheetHorizontalPadding, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("日记分类", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Category.entries.filter { it != Category.ALL }.forEach { category ->
                        val label = when (category) {
                            Category.DAILY -> "日常"
                            Category.WORK -> "工作"
                            Category.GOAL -> "目标"
                            Category.INSPIRATION -> "灵感"
                            Category.EMOTION -> "情绪"
                            else -> category.name
                        }
                        FilterChip(
                            selected = category == selectedCategory,
                            onClick = {
                                selectedCategory = category
                                dismissEditorSheet()
                            },
                            label = { Text(label) }
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }

    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && !isSaving) {
                scope.launch { saveLatestContent() }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            bridge.destroy()
        }
    }

    // 图片预览对话框
    if (previewImageDataUrl != null) {
        AlertDialog(
            onDismissRequest = { previewImageDataUrl = null },
            confirmButton = {
                TextButton(onClick = { previewImageDataUrl = null }) { Text("关闭") }
            },
            text = {
                AndroidView(factory = { ctx ->
                    ImageView(ctx).apply {
                        try {
                            val dataUrl = previewImageDataUrl!!
                            if (dataUrl.startsWith("file://")) {
                                setImageURI(Uri.parse(dataUrl))
                            } else {
                                val base64 = dataUrl.substringAfter(',')
                                val bytes = Base64.decode(base64, Base64.DEFAULT)
                                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                                setImageBitmap(bmp)
                            }
                            adjustViewBounds = true
                            scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                        } catch (_: Exception) {
                            DebugLog.event(DebugLog.AppEvent.IMAGE_PREVIEW_FAILED)
                        }
                    }
                }, modifier = Modifier.fillMaxWidth().height(windowSize.imagePreviewHeight))
            }
        )
    }
}

/** 将 Compose Color 转为 #RRGGBB 格式的十六进制字符串 */
private fun colorToHex(color: Color): String {
    val red = (color.red * 255).toInt()
    val green = (color.green * 255).toInt()
    val blue = (color.blue * 255).toInt()
    return "#%02X%02X%02X".format(red, green, blue)
}

// ==================== 文字工具栏 ====================

@Composable
private fun TextToolbarPanel(bridge: EditorBridge, onHide: () -> Unit) {
    val windowSize = rememberAppWindowSize()
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = windowSize.toolbarPanelPadding, vertical = 6.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        Column(modifier = Modifier.padding(if (windowSize.isNarrow) 10.dp else 12.dp)) {
            // 格式按钮行
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                FormatButton("B", FontWeight.Bold) { bridge.execCmd("bold") }
                FormatButton("I", FontWeight.Normal, italic = true) { bridge.execCmd("italic") }
                FormatButton("U", FontWeight.Normal, underline = true) { bridge.execCmd("underline") }
                FormatButton("S", FontWeight.Normal, strikethrough = true) { bridge.execCmd("strikeThrough") }
                Spacer(Modifier.width(8.dp))
                SmallIconButton(Icons.Filled.FormatAlignLeft) { bridge.execCmd("justifyLeft") }
                SmallIconButton(Icons.Filled.FormatAlignCenter) { bridge.execCmd("justifyCenter") }
                SmallIconButton(Icons.Filled.FormatAlignRight) { bridge.execCmd("justifyRight") }
                Spacer(Modifier.width(8.dp))
                SmallIconButton(Icons.Filled.Undo) { bridge.execCmd("undo") }
                SmallIconButton(Icons.Filled.Redo) { bridge.execCmd("redo") }
            }
            Spacer(Modifier.height(8.dp))
            // 字体和大小
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                var selectedFont by remember { mutableStateOf("handwrite") }
                var selectedSize by remember { mutableStateOf("3") }

                FilterChip(
                    selected = selectedFont == "handwrite",
                    onClick = { selectedFont = "handwrite"; bridge.changeFont("handwrite") },
                    label = { Text("手写体", fontSize = 12.sp) }
                )
                FilterChip(
                    selected = selectedFont == "serif",
                    onClick = { selectedFont = "serif"; bridge.changeFont("serif") },
                    label = { Text("宋体", fontSize = 12.sp) }
                )
                FilterChip(
                    selected = selectedFont == "sans-serif",
                    onClick = { selectedFont = "sans-serif"; bridge.changeFont("sans-serif") },
                    label = { Text("黑体", fontSize = 12.sp) }
                )
                Spacer(Modifier.width(8.dp))
                FilterChip(selected = selectedSize == "2", onClick = { selectedSize = "2"; bridge.changeSize("2") }, label = { Text("小", fontSize = 12.sp) })
                FilterChip(selected = selectedSize == "3", onClick = { selectedSize = "3"; bridge.changeSize("3") }, label = { Text("中", fontSize = 12.sp) })
                FilterChip(selected = selectedSize == "5", onClick = { selectedSize = "5"; bridge.changeSize("5") }, label = { Text("大", fontSize = 12.sp) })
            }
            Spacer(Modifier.height(8.dp))
            // 颜色选择
            val textColors = listOf("#333333", "#666666", "#FF6B6B", "#FFB6C1", "#FF8C42", "#FFD93D", "#6BCB77", "#4D96FF", "#9B59B6", "#1ABC9C", "#E91E63", "#795548")
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                textColors.forEach { colorStr ->
                    val color = Color(android.graphics.Color.parseColor(colorStr))
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(color)
                            .clickable { bridge.changeColor(colorStr) }
                    )
                }
            }
        }
    }
}

@Composable
private fun FormatButton(
    text: String,
    weight: FontWeight,
    italic: Boolean = false,
    underline: Boolean = false,
    strikethrough: Boolean = false,
    onClick: () -> Unit
) {
    OutlinedButton(
        onClick = onClick,
        modifier = Modifier.size(40.dp),
        contentPadding = PaddingValues(0.dp),
        shape = RoundedCornerShape(8.dp)
    ) {
        Text(
            text,
            fontWeight = weight,
            fontStyle = if (italic) androidx.compose.ui.text.font.FontStyle.Italic else androidx.compose.ui.text.font.FontStyle.Normal,
            textDecoration = when {
                underline -> TextDecoration.Underline
                strikethrough -> TextDecoration.LineThrough
                else -> TextDecoration.None
            },
            fontSize = 16.sp
        )
    }
}

@Composable
private fun SmallIconButton(icon: ImageVector, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(36.dp)) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ==================== 涂鸦工具栏 ====================

@Composable
private fun DoodleToolbarPanel(bridge: EditorBridge, onHide: () -> Unit) {
    val context = LocalContext.current
    val windowSize = rememberAppWindowSize()
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = windowSize.toolbarPanelPadding, vertical = 6.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        Column(modifier = Modifier.padding(if (windowSize.isNarrow) 10.dp else 12.dp)) {
            // 笔刷类型
            var activeBrush by remember { mutableStateOf("pencil") }
            var brushSize by remember { mutableStateOf(2f) }
            fun brushRange(brush: String): BrushSizeRange = when (brush) {
                "pencil", "pen" -> BrushSizeRange(0f, 5f, 2f)
                "watercolor", "marker", "highlighter" -> BrushSizeRange(5f, 25f, 12f)
                "eraser" -> BrushSizeRange(1f, 30f, 12f)
                else -> BrushSizeRange(0f, 5f, 2f)
            }
            fun formatBrushSize(value: Float): String =
                String.format(Locale.US, "%.2f", value).trimEnd('0').trimEnd('.')
            fun selectBrush(brush: String) {
                activeBrush = brush
                val range = brushRange(brush)
                if (brushSize < range.min || brushSize > range.max) {
                    brushSize = range.default
                }
                bridge.setBrush(brush)
                bridge.setBrushSize(formatBrushSize(brushSize))
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                BrushChip("pencil", "铅笔", activeBrush == "pencil") { selectBrush("pencil") }
                BrushChip("pen", "钢笔", activeBrush == "pen") { selectBrush("pen") }
                BrushChip("marker", "马克笔", activeBrush == "marker") { selectBrush("marker") }
                BrushChip("watercolor", "水彩", activeBrush == "watercolor") { selectBrush("watercolor") }
                BrushChip("highlighter", "荧光笔", activeBrush == "highlighter") { selectBrush("highlighter") }
                BrushChip("eraser", "橡皮擦", activeBrush == "eraser") { selectBrush("eraser") }
            }
            Spacer(Modifier.height(8.dp))
            // 笔刷大小
            val currentRange = brushRange(activeBrush)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text("粗细", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(8.dp))
                Slider(
                    value = brushSize,
                    onValueChange = {
                        brushSize = it
                        bridge.setBrushSize(formatBrushSize(it))
                    },
                    valueRange = currentRange.min..currentRange.max,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    formatBrushSize(brushSize),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(34.dp),
                    textAlign = TextAlign.Center
                )
            }
            Spacer(Modifier.height(8.dp))
            // 颜色选择
            val brushColors = listOf("#000000", "#333333", "#666666", "#FF0000", "#FF6B6B", "#FFB6C1", "#FF8C42", "#FFD93D", "#6BCB77", "#4D96FF", "#9B59B6", "#1ABC9C", "#E91E63", "#795548", "#00BCD4", "#CDDC39", "#FF69B4", "#8B4513", "#2E8B57", "#4169E1", "#FF4500", "#DA70D6", "#20B2AA", "#FFFFFF")
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                brushColors.forEach { colorStr ->
                    val color = Color(android.graphics.Color.parseColor(colorStr))
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(color)
                            .then(
                                if (colorStr == "#FFFFFF") Modifier.padding(1.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant) else Modifier
                            )
                            .clickable { bridge.setBrushColor(colorStr) }
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            // 操作按钮：两行布局，避免 300dp 宽度挤压
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = { bridge.undoDoodle() },
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                ) { Text("撤销", fontSize = 12.sp, maxLines = 1) }
                OutlinedButton(
                    onClick = { bridge.redoDoodle() },
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                ) { Text("重做", fontSize = 12.sp, maxLines = 1) }
                OutlinedButton(
                    onClick = { bridge.clearDoodle() },
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                ) { Text("清除", fontSize = 12.sp, maxLines = 1) }
            }
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = {
                        bridge.insertDoodleImage()
                        Toast.makeText(context, "已将涂鸦导出为图片插入正文", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                ) { Text("导出", fontSize = 12.sp, maxLines = 1) }
                Button(
                    onClick = { bridge.mergeDoodle(); onHide() },
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                ) { Text("确认", fontSize = 12.sp, maxLines = 1) }
            }
        }
    }
}

@Composable
private fun BrushChip(name: String, label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(label, fontSize = 12.sp) })
}

// ==================== 贴纸面板 ====================

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun StickerPanel(bridge: EditorBridge, onHide: () -> Unit) {
    val windowSize = rememberAppWindowSize()
    var userStickers by remember { mutableStateOf(bridge.listUserStickers()) }
    var pendingDeleteId by remember { mutableStateOf<String?>(null) }
    val refreshUserStickers = {
        userStickers = bridge.listUserStickers()
    }
    DisposableEffect(bridge) {
        bridge.onUserStickersChanged = { refreshUserStickers() }
        onDispose { bridge.onUserStickersChanged = null }
    }
    val stickerImportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { bridge.insertCustomSticker(it) }
    }
    if (pendingDeleteId != null) {
        AlertDialog(
            onDismissRequest = { pendingDeleteId = null },
            title = { Text("删除已导入贴纸") },
            text = { Text("仅从贴纸库移除，不会删除日记里已经贴上的贴纸。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingDeleteId?.let { bridge.deleteUserSticker(it) }
                        pendingDeleteId = null
                        refreshUserStickers()
                    }
                ) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { pendingDeleteId = null }) { Text("取消") }
            }
        )
    }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = windowSize.toolbarPanelPadding, vertical = 6.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        Column(modifier = Modifier.padding(if (windowSize.isNarrow) 10.dp else 12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("选择贴纸", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                TextButton(onClick = onHide) { Text("完成") }
            }
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(
                onClick = { stickerImportLauncher.launch("image/*") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(
                    imageVector = Icons.Filled.AddPhotoAlternate,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("导入贴纸")
            }
            if (userStickers.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    "已导入贴纸",
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 13.sp
                )
                Text(
                    "长按可从库中删除",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
                    fontSize = 11.sp
                )
                Spacer(modifier = Modifier.height(6.dp))
                userStickers.chunked(windowSize.stickerColumns).forEach { row ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        row.forEach { item ->
                            val thumb = remember(item.id, item.file.lastModified()) {
                                runCatching { BitmapFactory.decodeFile(item.file.absolutePath) }.getOrNull()
                            }
                            Box(
                                modifier = Modifier
                                    .size(windowSize.stickerCell)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))
                                    .combinedClickable(
                                        onClick = { bridge.insertUserSticker(item.id) },
                                        onLongClick = { pendingDeleteId = item.id }
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                if (thumb != null) {
                                    Image(
                                        bitmap = thumb.asImageBitmap(),
                                        contentDescription = "已导入贴纸",
                                        modifier = Modifier
                                            .fillMaxSize()
                                            .padding(6.dp)
                                    )
                                } else {
                                    Icon(
                                        imageVector = Icons.Filled.Image,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.45f)
                                    )
                                }
                            }
                        }
                        repeat((windowSize.stickerColumns - row.size).coerceAtLeast(0)) {
                            Spacer(modifier = Modifier.size(windowSize.stickerCell))
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                }
            }
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                "内置贴纸",
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 13.sp
            )
            Spacer(modifier = Modifier.height(6.dp))
            val stickers = listOf(
                StickerOption("heart", "❤️"),
                StickerOption("star", "⭐"),
                StickerOption("smile", "😊"),
                StickerOption("flower", "🌸"),
                StickerOption("sun", "☀️"),
                StickerOption("moon", "🌙"),
                StickerOption("cloud", "☁️"),
                StickerOption("rain", "🌧️"),
                StickerOption("snow", "❄️"),
                StickerOption("leaf", "🍃"),
                StickerOption("cat", "🐱"),
                StickerOption("dog", "🐶"),
                StickerOption("bird", "🐦"),
                StickerOption("fish", "🐟"),
                StickerOption("cake", "🎂"),
                StickerOption("coffee", "☕"),
                StickerOption("book", "📖"),
                StickerOption("music", "🎵"),
                StickerOption("sparkle", "✨"),
                StickerOption("ribbon", "🎀")
            )
            stickers.chunked(windowSize.stickerColumns).forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    row.forEach { sticker ->
                        Box(
                            modifier = Modifier
                                .size(windowSize.stickerCell)
                                .clip(RoundedCornerShape(12.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .clickable { bridge.insertSticker(sticker.name) },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(sticker.emoji, fontSize = windowSize.stickerEmojiSp.sp)
                        }
                    }
                }
                Spacer(modifier = Modifier.height(6.dp))
            }
        }
    }
}
