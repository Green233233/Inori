package com.green.inorinal.editor

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.green.inorinal.debug.DebugLog
import com.green.inorinal.media.JournalMediaStore
import com.green.inorinal.media.JournalMediaStore.Companion.toUriString
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.ByteArrayInputStream
import java.io.File
import kotlin.coroutines.resume

class EditorBridge(private val context: Context) {

    private val _content = MutableStateFlow("")
    /** 实时追踪的编辑器内容，由 JS onContentChanged 回调更新 */
    val content: StateFlow<String> = _content.asStateFlow()

    private val _doodleState = MutableStateFlow("{}")
    /** 涂鸦工具状态（撤销/重做可用性、当前工具、画笔参数等），由 JS 回调更新。 */
    val doodleState: StateFlow<String> = _doodleState.asStateFlow()

    private var webView: WebView? = null
    private var pageLoaded = false
    private val mediaStore = JournalMediaStore(context)
    private val bridgeScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    var currentEntryId: String? = null

    // 页面加载完成前待执行的主题 JS（避免因页面未就绪导致主题不同步）
    private var pendingThemeJs: String? = null
    private var pendingEditorSettingsJs: String? = null

    /** 待设置的内容 - 在页面加载完成后自动应用 */
    private var pendingContent: String? = null

    /** 涂鸦模式标志 - 控制 WebView 是否拦截触摸事件 */
    private var isDoodleMode = false

    @JavascriptInterface
    fun onContentChanged(html: String) {
        _content.value = html
    }

    @JavascriptInterface
    fun requestImageInsert() {
        onImageRequest?.invoke()
    }

    @JavascriptInterface
    fun onDoodleStateChanged(stateJson: String?) {
        _doodleState.value = stateJson.orEmpty().ifBlank { "{}" }
    }

    var onImageRequest: (() -> Unit)? = null

    fun setupWebView(webView: WebView, initialContent: String = "") {
        this.webView = webView
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = false
        webView.settings.blockNetworkLoads = true
        webView.settings.javaScriptCanOpenWindowsAutomatically = false
        webView.settings.setSupportMultipleWindows(false)
        webView.settings.loadWithOverviewMode = true
        webView.settings.useWideViewPort = true

        webView.addJavascriptInterface(this, "AndroidBridge")

        // 保存待设置的内容
        if (initialContent.isNotEmpty()) {
            pendingContent = initialContent
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                if (request?.isForMainFrame != true) return false
                return request.url.toString() != EDITOR_URL
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                if (url.scheme != "file") return null
                return if (isAllowedLocalFile(url.toString())) {
                    null
                } else {
                    WebResourceResponse(
                        "text/plain",
                        "utf-8",
                        ByteArrayInputStream(ByteArray(0))
                    )
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                pageLoaded = true
                // 页面加载完成后，设置待处理的内容
                pendingContent?.let { content ->
                    if (content.isNotEmpty()) {
                        setContent(content)
                    }
                    pendingContent = null
                }
                // 如果存在待执行的主题 JS，页面加载完成后再执行
                pendingThemeJs?.let { js ->
                    webView?.evaluateJavascript(js, null)
                    pendingThemeJs = null
                }
                pendingEditorSettingsJs?.let { js ->
                    webView?.evaluateJavascript(js, null)
                    pendingEditorSettingsJs = null
                }
            }
        }

        // 关键修复：覆盖 WebView 的触摸事件处理
        // 当涂鸦模式激活时，不让 WebView 拦截触摸事件，让它们传递到 HTML Canvas
        webView.setOnTouchListener { _, event ->
            if (isDoodleMode) {
                // 涂鸦模式下不消费事件，让触摸穿透到 HTML Canvas
                false
            } else {
                // 文本模式下正常处理
                false
            }
        }

        webView.loadUrl(EDITOR_URL)
    }

    /**
     * 设置待加载内容 - 可在页面加载前或加载后调用
     * 如果页面尚未加载完成，内容会被缓存并在 onPageFinished 后自动设置
     */
    fun setPendingContent(html: String) {
        if (html.isNotEmpty()) {
            _content.value = html
            if (pageLoaded) {
                setContent(html)
            } else {
                pendingContent = html
            }
        }
    }

    fun setContent(html: String) {
        _content.value = html
        if (!pageLoaded) {
            pendingContent = html
            return
        }
        evaluateJavascript("setContent(${escapeForJs(html)})")
    }

    /** 仅当 WebView 当前内容为空时才设置内容（避免覆盖用户已输入的内容） */
    fun setContentIfNeeded(html: String) {
        if (_content.value.isBlank() && html.isNotBlank()) {
            setContent(html)
        }
    }

    /** 异步获取内容（保留兼容） */
    fun getContent(callback: (String) -> Unit) {
        val view = webView
        if (view == null || !pageLoaded) {
            callback(_content.value)
            return
        }
        evaluateJavascript("getContent()") { result ->
            val content = decodeJsString(result)
            callback(content)
        }
    }

    suspend fun getContentForSave(): String =
        withTimeoutOrNull(2_000) {
            suspendCancellableCoroutine { continuation ->
                getContent { content ->
                    if (continuation.isActive) continuation.resume(content)
                }
            }
        } ?: _content.value

    /** 同步获取当前已追踪的内容 */
    fun getCurrentContent(): String = _content.value

    fun execCmd(command: String, value: String = "") {
        // 关键修复：执行格式命令前先让 WebView 获得焦点
        webView?.requestFocus()
        evaluateJavascript("execCmd(${escapeForJs(command)}${
            if (value.isNotEmpty()) ", ${escapeForJs(value)}" else ""
        })")
    }

    fun changeFont(fontName: String) {
        webView?.requestFocus()
        evaluateJavascript("changeFont(${escapeForJs(fontName)})")
    }

    fun changeSize(size: String) {
        webView?.requestFocus()
        evaluateJavascript("changeSize(${escapeForJs(size)})")
    }

    fun changeColor(color: String) {
        webView?.requestFocus()
        evaluateJavascript("changeColor(${escapeForJs(color)})")
    }

    fun insertImage(uri: Uri) {
        val entryId = currentEntryId ?: return
        bridgeScope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    processAndSaveImage(entryId, uri)
                }
                evaluateJavascript("insertImage(${escapeForJs(file.toUriString())})")
            } catch (_: OutOfMemoryError) {
                try {
                    val file = withContext(Dispatchers.IO) {
                        processAndSaveImage(entryId, uri, maxSizePixels = 500_000, quality = 50)
                    }
                    evaluateJavascript("insertImage(${escapeForJs(file.toUriString())})")
                } catch (_: OutOfMemoryError) {
                    DebugLog.event(DebugLog.AppEvent.IMAGE_PROCESSING_FAILED)
                } catch (_: Exception) {
                    DebugLog.event(DebugLog.AppEvent.IMAGE_PROCESSING_FAILED)
                }
            } catch (_: Exception) {
                DebugLog.event(DebugLog.AppEvent.IMAGE_PROCESSING_FAILED)
            }
        }
    }

    fun insertSticker(name: String) {
        webView?.requestFocus()
        evaluateJavascript("insertSticker(${escapeForJs(name)})")
    }

    // ==================== 涂鸦相关方法 ====================

    fun toggleDoodleMode(active: Boolean) {
        isDoodleMode = active
        evaluateJavascript("toggleDoodleMode($active)")
    }

    fun setBrush(type: String) {
        evaluateJavascript("setBrush(${escapeForJs(type)})")
    }

    fun setBrushSize(size: String) {
        evaluateJavascript("setBrushSize(${escapeForJs(size)})")
    }

    fun setBrushColor(color: String) {
        evaluateJavascript("setBrushColor(${escapeForJs(color)})")
    }

    fun setBrushRoughness(roughness: Float) {
        evaluateJavascript("setBrushRoughness(${roughness.coerceIn(0f, 4f)})")
    }

    fun undoDoodle() {
        evaluateJavascript("undoDoodle()")
    }

    fun redoDoodle() {
        evaluateJavascript("redoDoodle()")
    }

    fun clearDoodle() {
        evaluateJavascript("clearDoodle()")
    }

    fun mergeDoodle() {
        evaluateJavascript("mergeDoodle()")
    }

    fun insertDoodleImage() {
        evaluateJavascript("insertDoodleImage()")
    }

    suspend fun getDoodleJson(): String = evaluateJavascriptForResult("getDoodleJson()")

    suspend fun exportDoodleImage(): String = evaluateJavascriptForResult("exportDoodleImage()")

    // ==================== 主题相关方法 ====================

    fun applyTheme(
        isDark: Boolean,
        bgColor: String,
        textColor: String,
        paperBgStart: String,
        paperBgMid: String,
        paperBgEnd: String,
        lineColor: String
    ) {
        val js = "applyTheme($isDark, '$bgColor', '$textColor', '$paperBgStart', '$paperBgMid', '$paperBgEnd', '$lineColor')"
        if (pageLoaded) {
            evaluateJavascript(js)
        } else {
            pendingThemeJs = js
        }
    }

    fun applyEditorSettings(fontSizeSp: Int) {
        val js = "applyEditorSettings(${fontSizeSp.coerceIn(12, 28)})"
        if (pageLoaded) {
            evaluateJavascript(js)
        } else {
            pendingEditorSettingsJs = js
        }
    }

    /** 当编辑器中的图片被点击时由 JS 回调到这里 */
    var onImageClick: ((String) -> Unit)? = null

    @JavascriptInterface
    fun onImageClicked(dataUrl: String?) {
        if (dataUrl == null) return
        try {
            Handler(Looper.getMainLooper()).post {
                onImageClick?.invoke(dataUrl)
            }
        } catch (_: Exception) {
            DebugLog.event(DebugLog.AppEvent.IMAGE_CALLBACK_FAILED)
        }
    }

    // ==================== 私有辅助 ====================

    /**
     * 压缩图片并转为 JPEG 字节
     * @param maxSizePixels 最大像素数（宽×高），超过则等比缩放
     * @param quality JPEG 压缩质量 0-100
     */
    private fun processAndSaveImage(
        entryId: String,
        uri: Uri,
        maxSizePixels: Int = 1_500_000,
        quality: Int = 75
    ) = mediaStore.saveImage(entryId, compressImage(uri, maxSizePixels, quality), "jpg")

    private fun compressImage(uri: Uri, maxSizePixels: Int = 1_500_000, quality: Int = 75): ByteArray {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, options)
        } ?: error("Unable to open image")
        require(options.outWidth > 0 && options.outHeight > 0) { "Invalid image" }

        // 计算采样率以减少内存占用
        val totalPixels = options.outWidth.toLong() * options.outHeight.toLong()
        var sampleSize = 1
        if (totalPixels > maxSizePixels) {
            val targetSample = Math.sqrt(totalPixels.toDouble() / maxSizePixels.toDouble()).toInt()
            while (sampleSize < targetSample) sampleSize *= 2
        }

        val decodeOptions = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
        }
        val bitmap = context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, decodeOptions)
        } ?: error("Unable to decode image")

        // 进一步缩放如果仍然太大
        var scaledBitmap = bitmap
        val currentPixels = bitmap.width.toLong() * bitmap.height
        if (currentPixels > maxSizePixels) {
            val scale = Math.sqrt(maxSizePixels.toDouble() / currentPixels.toDouble())
            val newWidth = (bitmap.width * scale).toInt().coerceAtLeast(1)
            val newHeight = (bitmap.height * scale).toInt().coerceAtLeast(1)
            scaledBitmap = Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
            if (scaledBitmap != bitmap) {
                bitmap.recycle()
            }
        }

        // 压缩为 JPEG
        val outputStream = ByteArrayOutputStream()
        scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
        val imageBytes = outputStream.toByteArray()

        // 回收
        if (!scaledBitmap.isRecycled) {
            scaledBitmap.recycle()
        }
        outputStream.close()

        return imageBytes
    }

    private fun decodeJsString(result: String?): String {
        if (result.isNullOrBlank() || result == "null") return ""
        return runCatching {
            JSONArray("[$result]").getString(0)
        }.getOrDefault("")
    }

    private fun evaluateJavascript(script: String, callback: ((String?) -> Unit)? = null) {
        val view = webView ?: return
        if (callback == null) {
            view.evaluateJavascript(script, null)
        } else {
            view.evaluateJavascript(script) { result -> callback(result) }
        }
    }

    private fun isAllowedLocalFile(url: String): Boolean {
        if (url.startsWith(EDITOR_ASSET_PREFIX)) return true
        val path = Uri.parse(url).path.orEmpty()
        val file = runCatching { File(path).canonicalFile }.getOrNull() ?: return false
        val mediaRoot = runCatching { mediaStore.mediaRoot().canonicalFile }.getOrNull() ?: return false
        return file.path == mediaRoot.path || file.path.startsWith(mediaRoot.path + File.separator)
    }

    private suspend fun evaluateJavascriptForResult(script: String): String =
        withTimeoutOrNull(2_000) {
            suspendCancellableCoroutine { continuation ->
                evaluateJavascript(script) { result ->
                    if (continuation.isActive) continuation.resume(decodeJsString(result))
                }
            }
        } ?: ""

    private fun escapeForJs(str: String): String {
        val escaped = str
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
        return "\"$escaped\""
    }

    fun destroy() {
        bridgeScope.cancel()
        webView?.destroy()
        webView = null
    }

    private companion object {
        const val EDITOR_URL = "file:///android_asset/editor/editor.html"
        const val EDITOR_ASSET_PREFIX = "file:///android_asset/editor/"
    }
}
