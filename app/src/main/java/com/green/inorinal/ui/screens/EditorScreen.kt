package com.green.inorinal.ui.screens

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.activity.compose.BackHandler
import android.util.Base64
import android.graphics.BitmapFactory
import android.widget.ImageView
import com.green.inorinal.data.*
import com.green.inorinal.editor.EditorBridge
import com.green.inorinal.ui.icons.WeatherIcon
import com.green.inorinal.ui.icons.MoodIcon
import com.green.inorinal.ui.theme.*
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.util.UUID

private data class EditorSaveSnapshot(
    val title: String,
    val content: String,
    val weather: Weather,
    val mood: Mood,
    val category: Category
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(
    viewModel: JournalViewModel,
    entryId: String?,
    fontSizeSp: Int,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val bridge = remember { EditorBridge(context) }
    val scope = rememberCoroutineScope()
    var entry by remember { mutableStateOf<JournalEntry?>(null) }
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

    // 加载现有日记
    LaunchedEffect(entryId) {
        hasLoadedEntry = entryId == null
        if (entryId != null) {
            val loaded = viewModel.getEntryById(entryId)
            if (loaded != null) {
                entry = loaded
                title = loaded.title
                selectedWeather = loaded.weather
                selectedMood = loaded.mood
                selectedCategory = loaded.category
                // 关键修复：使用 setPendingContent 而非直接 setContent
                // 这确保内容在 WebView 页面加载完成后才被设置
                bridge.setPendingContent(loaded.content)
                lastSavedSnapshot = EditorSaveSnapshot(
                    title = loaded.title,
                    content = loaded.content,
                    weather = loaded.weather,
                    mood = loaded.mood,
                    category = loaded.category
                )
            }
        }
        hasLoadedEntry = true
    }

    // 图片选择器
    val imageLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { bridge.insertImage(it) }
    }

    bridge.onImageRequest = {
        imageLauncher.launch("image/*")
    }

    // 当 JS 中的图片被点击时，显示预览对话框
    bridge.onImageClick = { dataUrl ->
        previewImageDataUrl = dataUrl
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

    fun hasMeaningfulChanges(content: String): Boolean {
        return content.isNotBlank() ||
            selectedWeather != Weather.SUNNY ||
            selectedMood != Mood.HAPPY ||
            selectedCategory != Category.DAILY
    }

    // 即时保存日记
    suspend fun saveEntry(content: String = bridge.getCurrentContent()) {
        if (!hasLoadedEntry) {
            return
        }
        val currentEntry = entry
        if (currentEntry == null && !hasMeaningfulChanges(content)) {
            return
        }

        val baseEntry = currentEntry ?: createDraftEntry()
        val snapshot = EditorSaveSnapshot(
            title = title.ifBlank { baseEntry.title },
            content = content,
            weather = selectedWeather,
            mood = selectedMood,
            category = selectedCategory
        )
        if (lastSavedSnapshot == snapshot) {
            return
        }
        val savedEntry = viewModel.saveEntry(
            baseEntry.copy(
                title = snapshot.title,
                content = snapshot.content,
                weather = snapshot.weather,
                mood = snapshot.mood,
                category = snapshot.category
            )
        )
        entry = savedEntry
        lastSavedSnapshot = snapshot
    }

    LaunchedEffect(Unit) {
        bridge.content.collect { content ->
            saveEntry(content)
        }
    }

    LaunchedEffect(title, selectedWeather, selectedMood, selectedCategory, hasLoadedEntry) {
        saveEntry()
    }

    LaunchedEffect(fontSizeSp) {
        bridge.applyEditorSettings(fontSizeSp)
    }

    // 处理系统返回按钮：保存并返回
    BackHandler(enabled = true) {
        if (!isSaving) {
            isSaving = true
            scope.launch {
                saveEntry()
                onBack()
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = {
                        if (!isSaving) {
                            isSaving = true
                            scope.launch {
                                saveEntry()
                                onBack()
                            }
                        }
                    }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回并保存",
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                },
                title = {
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        placeholder = { Text("标题", color = MaterialTheme.colorScheme.onSurfaceVariant) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                            unfocusedBorderColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f),
                            focusedContainerColor = MaterialTheme.colorScheme.surface,
                            unfocusedContainerColor = MaterialTheme.colorScheme.surface
                        ),
                        textStyle = LocalTextStyle.current.copy(
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    )
                },
                actions = {
                    IconButton(onClick = { showWeatherPicker = !showWeatherPicker }) {
                        WeatherIcon(selectedWeather, size = 20.dp, tint = MaterialTheme.colorScheme.primary)
                    }
                    IconButton(onClick = { showMoodPicker = !showMoodPicker }) {
                        MoodIcon(selectedMood, size = 20.dp, tint = MaterialTheme.colorScheme.primary)
                    }
                    IconButton(onClick = { showCategoryPicker = !showCategoryPicker }) {
                        Icon(
                            Icons.Filled.Dashboard,
                            contentDescription = "分类",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            Column {
                // 天气选择器
                AnimatedVisibility(visible = showWeatherPicker) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            Weather.entries.forEach { weather ->
                                IconButton(
                                    onClick = {
                                        selectedWeather = weather
                                        showWeatherPicker = false
                                    }
                                ) {
                                    WeatherIcon(
                                        weather,
                                        size = 28.dp,
                                        tint = if (weather == selectedWeather) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }

                // 心情选择器
                AnimatedVisibility(visible = showMoodPicker) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            Mood.entries.forEach { mood ->
                                IconButton(
                                    onClick = {
                                        selectedMood = mood
                                        showMoodPicker = false
                                    }
                                ) {
                                    MoodIcon(
                                        mood,
                                        size = 28.dp,
                                        tint = if (mood == selectedMood) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }

                // 分类选择器
                AnimatedVisibility(visible = showCategoryPicker) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp)
                                .horizontalScroll(rememberScrollState()),
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
                                        showCategoryPicker = false
                                    },
                                    label = { Text(label, fontSize = 13.sp) }
                                )
                            }
                        }
                    }
                }

                // 工具栏面板
                AnimatedVisibility(visible = currentToolbar == "text") {
                    TextToolbarPanel(bridge = bridge, onHide = { currentToolbar = "none" })
                }

                AnimatedVisibility(visible = currentToolbar == "doodle") {
                    DoodleToolbarPanel(bridge = bridge, onHide = { currentToolbar = "none" })
                }

                AnimatedVisibility(visible = currentToolbar == "sticker") {
                    StickerPanel(bridge = bridge, onHide = { currentToolbar = "none" })
                }

                // 底部导航栏
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 4.dp
                ) {
                    NavigationBarItem(
                        icon = { Icon(Icons.Filled.TextFields, contentDescription = "文字") },
                        label = { Text("文字", fontSize = 10.sp) },
                        selected = currentToolbar == "text",
                        onClick = {
                            currentToolbar = if (currentToolbar == "text") "none" else "text"
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
                        icon = { Icon(Icons.Filled.EmojiEmotions, contentDescription = "贴纸") },
                        label = { Text("贴纸", fontSize = 10.sp) },
                        selected = currentToolbar == "sticker",
                        onClick = {
                            currentToolbar = if (currentToolbar == "sticker") "none" else "sticker"
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
        val isDark = isSystemInDarkTheme()
        val bgColor = colorToHex(MaterialTheme.colorScheme.background)
        val textColor = colorToHex(MaterialTheme.colorScheme.onBackground)
        val paperBgStart = colorToHex(MaterialTheme.colorScheme.surface)
        val paperBgMid = colorToHex(MaterialTheme.colorScheme.surface)
        val paperBgEnd = colorToHex(MaterialTheme.colorScheme.surface)
        val lineColor = if (isDark) "rgba(255,255,255,0.05)" else "rgba(0,0,0,0.03)"

        AndroidView(
            factory = { ctx ->
                android.webkit.WebView(ctx).also { webView ->
                    bridge.setupWebView(webView)
                    webViewCreated = true
                }
            },
            update = { webView ->
                // 每次重组时应用主题
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
                .fillMaxSize()
                .padding(innerPadding)
        )
    }

    DisposableEffect(Unit) {
        onDispose {
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
                            val base64 = previewImageDataUrl!!.substringAfter(',')
                            val bytes = Base64.decode(base64, Base64.DEFAULT)
                            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                            setImageBitmap(bmp)
                            adjustViewBounds = true
                            scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                }, modifier = Modifier.fillMaxWidth().height(420.dp))
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
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
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
                modifier = Modifier.fillMaxWidth(),
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
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // 笔刷类型
            var activeBrush by remember { mutableStateOf("pencil") }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                BrushChip("pencil", "铅笔", activeBrush == "pencil") { activeBrush = "pencil"; bridge.setBrush("pencil") }
                BrushChip("pen", "钢笔", activeBrush == "pen") { activeBrush = "pen"; bridge.setBrush("pen") }
                BrushChip("marker", "马克笔", activeBrush == "marker") { activeBrush = "marker"; bridge.setBrush("marker") }
                BrushChip("watercolor", "水彩", activeBrush == "watercolor") { activeBrush = "watercolor"; bridge.setBrush("watercolor") }
                BrushChip("highlighter", "荧光笔", activeBrush == "highlighter") { activeBrush = "highlighter"; bridge.setBrush("highlighter") }
                BrushChip("eraser", "橡皮擦", activeBrush == "eraser") { activeBrush = "eraser"; bridge.setBrush("eraser") }
            }
            Spacer(Modifier.height(8.dp))
            // 笔刷大小
            var brushSize by remember { mutableStateOf(3f) }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text("粗细", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(8.dp))
                Slider(
                    value = brushSize,
                    onValueChange = { brushSize = it; bridge.setBrushSize(it.toInt().toString()) },
                    valueRange = 1f..30f,
                    modifier = Modifier.weight(1f)
                )
                Text("${brushSize.toInt()}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(24.dp), textAlign = TextAlign.Center)
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
            // 操作按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                OutlinedButton(onClick = { bridge.undoDoodle() }) { Text("撤销", fontSize = 12.sp) }
                OutlinedButton(onClick = { bridge.redoDoodle() }) { Text("重做", fontSize = 12.sp) }
                OutlinedButton(onClick = { bridge.clearDoodle() }) { Text("清除", fontSize = 12.sp) }
                Button(onClick = { bridge.mergeDoodle(); onHide() }) { Text("确认", fontSize = 12.sp) }
            }
        }
    }
}

@Composable
private fun BrushChip(name: String, label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(label, fontSize = 12.sp) })
}

// ==================== 贴纸面板 ====================

@Composable
private fun StickerPanel(bridge: EditorBridge, onHide: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("选择贴纸", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                TextButton(onClick = onHide) { Text("完成") }
            }
            Spacer(Modifier.height(8.dp))
            val stickers = listOf(
                "heart" to "❤️", "star" to "⭐", "smile" to "😊", "flower" to "🌸",
                "sun" to "☀️", "moon" to "🌙", "cloud" to "☁️", "rain" to "🌧️",
                "snow" to "❄️", "leaf" to "🍃", "cat" to "🐱", "dog" to "🐶",
                "bird" to "🐦", "fish" to "🐟", "cake" to "🎂", "coffee" to "☕",
                "book" to "📖", "music" to "🎵", "sparkle" to "✨", "ribbon" to "🎀"
            )
            stickers.chunked(5).forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    row.forEach { (name, emoji) ->
                        Box(
                            modifier = Modifier
                                .size(52.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .clickable { bridge.insertSticker(name) },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(emoji, fontSize = 28.sp)
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
            }
        }
    }
}
