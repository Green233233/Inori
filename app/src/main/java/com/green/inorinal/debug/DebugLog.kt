package com.green.inorinal.debug

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
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
    private const val MAX_LOG_FILE_BYTES = 2L * 1024 * 1024
    private const val RETENTION_DAYS = 7L
    private const val MAX_STACK_FRAMES = 64

    /** 固定的无隐私技术事件，避免调用方将任意用户文本写入日志。 */
    enum class AppEvent(internal val component: String, internal val description: String) {
        DEBUG_ENABLED("DebugLog", "调试模式已开启"),
        APP_FOREGROUND("Lifecycle", "应用进入前台"),
        APP_BACKGROUND("Lifecycle", "应用进入后台"),
        IMAGE_PROCESSING_FAILED("Editor", "图片处理失败"),
        IMAGE_PREVIEW_FAILED("Editor", "图片预览失败"),
        IMAGE_CALLBACK_FAILED("Editor", "图片回调失败"),
        JOURNAL_SAVE_FAILED("Editor", "日记保存失败")
    }

    @Volatile
    private var enabled = false

    @Volatile
    private var logDir: File? = null

    private val executor = Executors.newSingleThreadExecutor()
    private val timeFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS")
    private val fileNameFormat = DateTimeFormatter.ISO_LOCAL_DATE

    @Volatile
    private var crashHandlerInstalled = false

    /** 在应用启动时调用，只初始化目录和崩溃处理器；启用状态应在读取设置后单独应用。 */
    fun init(context: Context) {
        val appContext = context.applicationContext
        // 外部应用专属目录便于 adb 读取；回退目录禁止参与系统云备份。
        val baseDir = appContext.getExternalFilesDir(null) ?: appContext.noBackupFilesDir
        logDir = File(baseDir, "logs")
        installCrashHandler()
    }

    /** 启用或关闭调试日志记录。 */
    fun setEnabled(value: Boolean) {
        enabled = value
        if (value) {
            ensureDir()
            cleanupExpiredLogs()
            event(AppEvent.DEBUG_ENABLED)
        } else {
            // 用户撤回调试授权后删除已收集日志，避免数据继续留存。
            clearLogs()
        }
    }

    fun isEnabled(): Boolean = enabled

    /** 返回日志所在目录的绝对路径，用于在界面上提示开发者。 */
    fun logDirectoryPath(): String? = logDir?.absolutePath

    /** 记录预定义的无隐私技术事件，不接受任意用户文本。 */
    fun event(event: AppEvent) {
        if (!enabled) return
        val description = if (event == AppEvent.DEBUG_ENABLED) {
            "${event.description}；Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
        } else {
            event.description
        }
        Log.d(LOGCAT_TAG, "[${event.component}] $description")
        val timestamp = LocalDateTime.now().format(timeFormat)
        executor.execute {
            writeLine("$timestamp [${event.component}] $description")
        }
    }

    /** 删除本应用产生的全部调试日志。 */
    fun clearLogs() {
        executor.execute {
            logDir?.listFiles()?.forEach { file ->
                if (file.isFile && file.name.startsWith("inorinal-") && file.extension == "log") {
                    file.delete()
                }
            }
        }
    }

    private fun installCrashHandler() {
        if (crashHandlerInstalled) return
        crashHandlerInstalled = true
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            if (enabled) {
                // 崩溃时进程即将退出，同步写入以确保落盘。
                writeLine(buildPrivacySafeCrashReport(throwable))
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
        return File(dir, "inorinal-${LocalDate.now().format(fileNameFormat)}.log")
    }

    @Synchronized
    private fun writeLine(line: String) {
        try {
            ensureDir()
            val file = currentLogFile() ?: return
            rotateIfNeeded(file, line)
            file.appendText(line + "\n")
        } catch (_: Exception) {
            // 日志写入失败不应影响应用运行。
        }
    }

    private fun rotateIfNeeded(file: File, nextLine: String) {
        if (!file.exists() || file.length() + nextLine.toByteArray().size <= MAX_LOG_FILE_BYTES) return
        val rotated = File(file.parentFile, "${file.nameWithoutExtension}.1.log")
        if (rotated.exists()) rotated.delete()
        file.renameTo(rotated)
    }

    private fun cleanupExpiredLogs() {
        val cutoff = System.currentTimeMillis() - RETENTION_DAYS * 24 * 60 * 60 * 1000
        logDir?.listFiles()?.forEach { file ->
            if (file.isFile &&
                file.name.startsWith("inorinal-") &&
                file.extension == "log" &&
                file.lastModified() < cutoff
            ) {
                file.delete()
            }
        }
    }

    /**
     * 只保存异常类型和应用堆栈帧，不保存 throwable.message。
     * 异常消息可能包含日记内容、搜索词、文件路径等用户隐私数据。
     */
    private fun buildPrivacySafeCrashReport(throwable: Throwable): String {
        val output = StringBuilder()
            .append(LocalDateTime.now().format(timeFormat))
            .append(" [CRASH] 未捕获异常\n")

        var current: Throwable? = throwable
        var causeDepth = 0
        while (current != null && causeDepth < 8) {
            output.append(if (causeDepth == 0) "异常类型：" else "原因类型：")
                .append(current.javaClass.name)
                .append('\n')
            current.stackTrace
                .asSequence()
                .filter { it.className.startsWith("com.green.inorinal") }
                .take(MAX_STACK_FRAMES)
                .forEach { frame -> output.append("  at ").append(frame).append('\n') }
            current = current.cause
            causeDepth++
        }
        return output.toString().trimEnd()
    }
}
