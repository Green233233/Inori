package com.inorinal.qi

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.io.File

/**
 * Read-only notification relay.
 *
 * 默认转发所有应用的通知，只跳过黑名单里的应用（blocklist）。这是用户明确选择的
 * 默认放行模式，因此小狗端页面必须把风险说清楚：验证码、金额、联系人等都会随
 * 通知一起发出去，且不再打码。
 *
 * 事件只写入有界本地队列（JSONL），由 JS 在下次前台时 drain；监听服务不联网。
 * 只读取 title/text，不读取回复动作、不读取 remote input、不主动清除通知。
 */
class NotificationRelayService : NotificationListenerService() {

  override fun onListenerConnected() {
    connected = true
    super.onListenerConnected()
  }

  override fun onListenerDisconnected() {
    connected = false
    super.onListenerDisconnected()
  }

  override fun onDestroy() {
    connected = false
    super.onDestroy()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val statusBar = sbn ?: return
    val context = applicationContext ?: return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val blocklist = prefs.getStringSet(PREF_BLOCKLIST, emptySet()) ?: emptySet()
    val packageName = statusBar.packageName ?: return
    // 默认放行：只有明确拉黑的应用才不转发。
    if (blocklist.contains(packageName)) return

    val extras = statusBar.notification?.extras ?: return
    val title =
      extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text =
      (
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
          ?: extras.getCharSequence(Notification.EXTRA_TEXT)
        )
        ?.toString()
        .orEmpty()
    if (title.isEmpty() && text.isEmpty()) return

    val record =
      JSONObject()
        .put("at", System.currentTimeMillis())
        .put("pkg", packageName)
        .put("title", Sanitizer.clean(title))
        .put("text", Sanitizer.clean(text))
    append(context, record)
  }

  private fun append(context: Context, record: JSONObject) {
    try {
      val file = queueFile(context)
      file.appendText(record.toString() + "\n")
      if (file.length() > MAX_BYTES) trim(file)
    } catch (ignored: Exception) {
      // A relay that fails must never crash the listener service.
    }
  }

  /** Keeps the newest [MAX_LINES] lines; the queue is a cache, not a log. */
  private fun trim(file: File) {
    val lines = file.readLines()
    if (lines.size <= MAX_LINES) return
    file.writeText(lines.takeLast(MAX_LINES).joinToString("\n", postfix = "\n"))
  }

  companion object {
    const val PREFS = "qi.notify"
    const val PREF_BLOCKLIST = "blocklist"

    private const val MAX_LINES = 300
    private const val MAX_BYTES = 512L * 1024L

    @Volatile var connected: Boolean = false

    fun queueFile(context: Context): File {
      val dir = File(context.filesDir, "qi").apply { if (!exists()) mkdirs() }
      return File(dir, "notifications.jsonl")
    }

    fun prefs(context: Context): SharedPreferences =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  }
}

/**
 * 通知内容按原样转发（不再打码）：只在长度上做截断，避免一条通知占满队列。
 * 验证码、金额、账号等可能因此出现在主人端，小狗端会明确提示风险。
 */
object Sanitizer {
  fun clean(input: String): String {
    if (input.isEmpty()) return ""
    return if (input.length > MAX_CHARS) input.take(MAX_CHARS) + "…" else input
  }

  private const val MAX_CHARS = 200
}
