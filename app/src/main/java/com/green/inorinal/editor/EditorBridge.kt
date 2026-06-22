package com.green.inorinal.editor

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import com.green.inorinal.media.JournalMediaStore
import com.green.inorinal.media.JournalMediaStore.Companion.toUriString
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlin.coroutines.resume

class EditorBridge(private val context: Context) {

    private val _content = MutableStateFlow("")
    /** 实时追踪的编辑器内容，由 JS onContentChanged 回调更新 */
    val content: StateFlow<String> = _content.asStateFlow()

    private var webView: WebView? = null
    private var pageLoaded = false
    private val mediaStore = JournalMediaStore(context)
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

    var onImageRequest: (() -> Unit)? = null

    fun setupWebView(webView: WebView, initialContent: String = "") {
        this.webView = webView
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        webView.settings.loadWithOverviewMode = true
        webView.settings.useWideViewPort = true

        webView.addJavascriptInterface(this, "AndroidBridge")

        // 保存待设置的内容
        if (initialContent.isNotEmpty()) {
            pendingContent = initialContent
        }

        webView.webViewClient = object : WebViewClient() {
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

        webView.loadUrl("file:///android_asset/editor/editor.html")
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
        webView?.evaluateJavascript("setContent(${escapeForJs(html)})", null)
    }

    /** 仅当 WebView 当前内容为空时才设置内容（避免覆盖用户已输入的内容） */
    fun setContentIfNeeded(html: String) {
        if (_content.value.isBlank() && html.isNotBlank()) {
            setContent(html)
        }
    }

    /** 异步获取内容（保留兼容） */
    fun getContent(callback: (String) -> Unit) {
        webView?.evaluateJavascript("getContent()") { result ->
            val content = decodeJsString(result)
            callback(content)
        }
    }

    suspend fun getContentForSave(): String = suspendCancellableCoroutine { continuation ->
        getContent { content ->
            if (continuation.isActive) continuation.resume(content)
        }
    }

    /** 同步获取当前已追踪的内容 */
    fun getCurrentContent(): String = _content.value

    fun execCmd(command: String, value: String = "") {
        // 关键修复：执行格式命令前先让 WebView 获得焦点
        webView?.requestFocus()
        webView?.evaluateJavascript("execCmd('$command'${
            if (value.isNotEmpty()) ", '$value'" else ""
        })", null)
    }

    fun changeFont(fontName: String) {
        webView?.requestFocus()
        webView?.evaluateJavascript("changeFont('$fontName')", null)
    }

    fun changeSize(size: String) {
        webView?.requestFocus()
        webView?.evaluateJavascript("changeSize('$size')", null)
    }

    fun changeColor(color: String) {
        webView?.requestFocus()
        webView?.evaluateJavascript("changeColor('$color')", null)
    }

    fun insertImage(uri: Uri) {
        val entryId = currentEntryId ?: return
        try {
            val inputStream = context.contentResolver.openInputStream(uri)
            val compressedBytes = compressImage(inputStream)
            inputStream?.close()
            val file = mediaStore.saveImage(entryId, compressedBytes, "jpg")
            webView?.evaluateJavascript("insertImage(${escapeForJs(file.toUriString())})", null)
        } catch (e: OutOfMemoryError) {
            // OOM 保护：尝试更激进的压缩
            try {
                System.gc()
                val inputStream = context.contentResolver.openInputStream(uri)
                val compressedBytes = compressImage(inputStream, maxSizePixels = 500_000, quality = 50)
                inputStream?.close()
                val file = mediaStore.saveImage(entryId, compressedBytes, "jpg")
                webView?.evaluateJavascript("insertImage(${escapeForJs(file.toUriString())})", null)
            } catch (e2: Exception) {
                e2.printStackTrace()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun insertSticker(name: String) {
        webView?.requestFocus()
        webView?.evaluateJavascript("insertSticker('$name')", null)
    }

    // ==================== 涂鸦相关方法 ====================

    fun toggleDoodleMode(active: Boolean) {
        isDoodleMode = active
        webView?.evaluateJavascript("toggleDoodleMode($active)", null)
    }

    fun setBrush(type: String) {
        webView?.evaluateJavascript("setBrush('$type')", null)
    }

    fun setBrushSize(size: String) {
        webView?.evaluateJavascript("setBrushSize('$size')", null)
    }

    fun setBrushColor(color: String) {
        webView?.evaluateJavascript("setBrushColor('$color')", null)
    }

    fun undoDoodle() {
        webView?.evaluateJavascript("undoDoodle()", null)
    }

    fun redoDoodle() {
        webView?.evaluateJavascript("redoDoodle()", null)
    }

    fun clearDoodle() {
        webView?.evaluateJavascript("clearDoodle()", null)
    }

    fun mergeDoodle() {
        webView?.evaluateJavascript("mergeDoodle()", null)
    }

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
            webView?.evaluateJavascript(js, null)
        } else {
            pendingThemeJs = js
        }
    }

    fun applyEditorSettings(fontSizeSp: Int) {
        val js = "applyEditorSettings(${fontSizeSp.coerceIn(12, 28)})"
        if (pageLoaded) {
            webView?.evaluateJavascript(js, null)
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
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ==================== 私有辅助 ====================

    /**
     * 压缩图片并转为 JPEG 字节
     * @param maxSizePixels 最大像素数（宽×高），超过则等比缩放
     * @param quality JPEG 压缩质量 0-100
     */
    private fun compressImage(inputStream: InputStream?, maxSizePixels: Int = 1_500_000, quality: Int = 75): ByteArray {
        if (inputStream == null) return ByteArray(0)

        val bytes = inputStream.readBytes()
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)

        // 计算采样率以减少内存占用
        val totalPixels = (options.outWidth * options.outHeight).toLong()
        var sampleSize = 1
        if (totalPixels > maxSizePixels) {
            sampleSize = Math.sqrt(totalPixels.toDouble() / maxSizePixels.toDouble()).toInt().coerceAtLeast(1)
        }

        val decodeOptions = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOptions) ?: return ByteArray(0)

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
        webView?.destroy()
        webView = null
    }
}
