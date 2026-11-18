package com.inorinal.qi

import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * JS side of [NotificationRelayService].
 *
 * `drain` is the only read path: it returns queued relayed notifications and
 * removes exactly those, so a resumed app never duplicates a message. All file
 * work happens on a dedicated thread — the listener service may be appending at
 * the same time, and blocking the JS thread here would stall the UI.
 */
class NotificationRelayModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "qi-notify").apply { isDaemon = true }
  }

  override fun getName(): String = "QiNotificationRelay"

  @ReactMethod
  fun drain(limit: Int, promise: Promise) {
    val take = limit.coerceIn(0, 200)
    io.execute {
      try {
        val context = reactApplicationContext
        val file = NotificationRelayService.queueFile(context)
        if (!file.exists() || take == 0) {
          promise.resolve(Arguments.createArray())
          return@execute
        }
        val lines = file.readLines()
        val head = lines.take(take)
        val rest = lines.drop(take)
        if (rest.isEmpty()) file.delete() else file.writeText(rest.joinToString("\n", postfix = "\n"))
        val array = Arguments.createArray()
        head.forEach { line ->
          if (line.isBlank()) return@forEach
          val record = runCatching { JSONObject(line) }.getOrNull() ?: return@forEach
          val map = Arguments.createMap()
          map.putDouble("at", record.optLong("at", 0L).toDouble())
          map.putString("pkg", record.optString("pkg", ""))
          map.putString("title", record.optString("title", ""))
          map.putString("text", record.optString("text", ""))
          array.pushMap(map)
        }
        promise.resolve(array)
      } catch (error: Exception) {
        promise.reject("notify_drain_failed", error.message, error)
      }
    }
  }

  @ReactMethod
  fun setBlocklist(packages: ReadableArray, promise: Promise) {
    try {
      val values = HashSet<String>()
      for (index in 0 until packages.size()) {
        val pkg = packages.getString(index)?.trim() ?: continue
        // 只允许拉黑真实安装的应用；否则一个笔误就会让某个应用继续被转发。
        if (pkg.isEmpty()) continue
        if (isInstalled(pkg)) values.add(pkg)
      }
      NotificationRelayService.prefs(reactApplicationContext)
        .edit()
        .putStringSet(NotificationRelayService.PREF_BLOCKLIST, values)
        .apply()
      promise.resolve(values.size)
    } catch (error: Exception) {
      promise.reject("notify_blocklist_failed", error.message, error)
    }
  }

  @ReactMethod
  fun getBlocklist(promise: Promise) {
    val values =
      NotificationRelayService.prefs(reactApplicationContext)
        .getStringSet(NotificationRelayService.PREF_BLOCKLIST, emptySet())
        ?: emptySet()
    val array = Arguments.createArray()
    values.sorted().forEach { array.pushString(it) }
    promise.resolve(array)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    // File scan is IO: keep it off the JS thread (which also drives the guard
    // long poll) even though the queue is small.
    io.execute {
      val context = reactApplicationContext
      val enabled =
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
      val file = NotificationRelayService.queueFile(context)
      val queued =
        try {
          if (file.exists()) file.readLines().count { it.isNotBlank() } else 0
        } catch (error: Exception) {
          0
        }
      val map = Arguments.createMap()
      map.putBoolean("enabled", enabled)
      map.putBoolean("connected", NotificationRelayService.connected)
      map.putInt("queued", queued)
      map.putInt("blocklistSize", getBlocklistSize())
      promise.resolve(map)
    }
  }

  private fun getBlocklistSize(): Int =
    NotificationRelayService.prefs(reactApplicationContext)
      .getStringSet(NotificationRelayService.PREF_BLOCKLIST, emptySet())
      ?.size ?: 0

  private fun isInstalled(pkg: String): Boolean =
    try {
      reactApplicationContext.packageManager.getPackageInfo(pkg, 0)
      true
    } catch (error: Exception) {
      false
    }
}
