package com.green.inorinal.debug

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * 应用级调试日志管理器。
 *
 * 仅在用户于设置中开启「调试模式」后才会记录日志，日志写入应用专属外部目录
 * （/Android/data/<包名>/files/logs/），开发者可通过文件管理器或 `adb pull` 直接读取，
 * 无需额外权限。开启后还会捕获未处理异常的堆栈以便排查崩溃。
 */
object DebugLog {
    private const val LOGCAT_TAG = "Inorinal"

    @Volatile
    private var enabled = false

    @Volatile
    private var logDir: File? = null

    private val executor = Executors.newSingleThreadExecutor()
    private val timeFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    private val fileNameFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    @Volatile
    private var crashHandlerInstalled = false

    /** 在应用启动时调用，初始化日志目录并按持久化的开关状态启用。 */
    fun init(context: Context, enabled: Boolean) {
        val appContext = context.applicationContext
        val baseDir = appContext.getExternalFilesDir(null) ?: appContext.filesDir
        logDir = File(baseDir, "logs")
        installCrashHandler()
        setEnabled(enabled)
    }

    /** 启用或关闭调试日志记录。 */
    fun setEnabled(value: Boolean) {
        enabled = value
        if (value) {
            ensureDir()
            log(
                "DebugLog",
                "调试模式已开启，设备：${Build.MANUFACTURER} ${Build.MODEL}，系统：Android ${Build.VERSION.RELEASE}"
            )
        }
    }

    fun isEnabled(): Boolean = enabled

    /** 返回日志所在目录的绝对路径，用于在界面上提示开发者。 */
    fun logDirectoryPath(): String? = logDir?.absolutePath

    /** 记录一条普通日志。仅在调试模式开启时写入文件，但始终输出到 Logcat。 */
    fun log(tag: String, message: String) {
        Log.d(LOGCAT_TAG, "[$tag] $message")
        if (!enabled) return
        val timestamp = timeFormat.format(Date())
        executor.execute {
            writeLine("$timestamp [$tag] $message")
        }
    }

    private fun installCrashHandler() {
        if (crashHandlerInstalled) return
        crashHandlerInstalled = true
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            if (enabled) {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                // 崩溃时进程即将退出，同步写入以确保落盘。
                writeLine("${timeFormat.format(Date())} [CRASH] 线程 ${thread.name} 未捕获异常\n$sw")
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    private fun ensureDir() {
        val dir = logDir ?: return
        if (!dir.exists()) dir.mkdirs()
    }

    private fun currentLogFile(): File? {
        val dir = logDir ?: return null
        return File(dir, "inorinal-${fileNameFormat.format(Date())}.log")
    }

    @Synchronized
    private fun writeLine(line: String) {
        try {
            ensureDir()
            currentLogFile()?.appendText(line + "\n")
        } catch (_: Exception) {
            // 日志写入失败不应影响应用运行。
        }
    }
}
