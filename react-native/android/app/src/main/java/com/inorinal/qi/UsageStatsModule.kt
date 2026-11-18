package com.inorinal.qi

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Process
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.Calendar
import java.util.concurrent.Executors

/**
 * On-demand usage aggregation. There is deliberately no background timer here:
 * querying usage stats is a database scan and doing it periodically would show
 * up in both battery stats and "why is this app reading my usage" reviews. JS
 * asks when a screen is opened, and the scan happens once.
 *
 * Two sources, on purpose:
 *  - queryUsageStats(INTERVAL_DAILY) is the cheap aggregate the OS already
 *    maintains, good for "today"/"7 days" totals;
 *  - queryEvents gives session boundaries, which is the only way to get a
 *    session count (and to verify the aggregate is not double counting).
 * Top 8 is computed from the aggregate and capped, because a 200-row list is
 * noise, not insight.
 */
class UsageStatsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "qi-usage").apply { isDaemon = true }
  }
  private val labels = HashMap<String, String>()
  private val labelsLock = Any()

  override fun getName(): String = "QiUsageStats"

  @ReactMethod
  fun queryUsageStats(interval: String, days: Int, promise: Promise) {
    if (!hasUsageAccess()) {
      promise.reject("usage_permission_missing", "请在设置里授予「使用情况访问」权限")
      return
    }
    io.execute {
      try {
        promise.resolve(usageBlock(interval, days))
      } catch (error: Exception) {
        promise.reject("usage_query_failed", error.message, error)
      }
    }
  }

  @ReactMethod
  fun queryEvents(days: Int, promise: Promise) {
    if (!hasUsageAccess()) {
      promise.reject("usage_permission_missing", "请在设置里授予「使用情况访问」权限")
      return
    }
    io.execute {
      try {
        promise.resolve(eventsBlock(days))
      } catch (error: Exception) {
        promise.reject("usage_events_failed", error.message, error)
      }
    }
  }

  /** One call for the home screen: today + 7 days + top 8. */
  @ReactMethod
  fun aggregate(promise: Promise) {
    if (!hasUsageAccess()) {
      promise.reject("usage_permission_missing", "请在设置里授予「使用情况访问」权限")
      return
    }
    io.execute {
      try {
        val today = usageBlock("daily", 1)
        val week = usageBlock("daily", 7)
        val events = eventsBlock(7)
        // Read the array before putMap: WritableMap.putMap consumes the child map,
        // and reading it afterwards throws "Map already consumed".
        val top = today.getArray("top")
        val result = Arguments.createMap()
        result.putMap("today", today)
        result.putMap("week", week)
        result.putMap("events", events)
        result.putArray("top", top ?: Arguments.createArray())
        result.putDouble("generatedAt", System.currentTimeMillis().toDouble())
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("usage_aggregate_failed", error.message, error)
      }
    }
  }

  // ---------------------------------------------------------------- internals

  private fun usageBlock(interval: String, days: Int): WritableMap {
    val manager =
      reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val range = dayRange(days.coerceIn(1, 30))
    val intervalType =
      if (interval.equals("best", ignoreCase = true)) {
        UsageStatsManager.INTERVAL_BEST
      } else {
        UsageStatsManager.INTERVAL_DAILY
      }
    val stats = manager.queryUsageStats(intervalType, range.first, range.second) ?: emptyList()
    val totals = HashMap<String, Long>()
    stats.forEach { entry ->
      // Buckets are pre-aggregated by the OS; lastTimeStamp >= begin keeps only
      // buckets that end inside the requested window.
      if (entry.lastTimeStamp < range.first) return@forEach
      if (entry.packageName == reactApplicationContext.packageName) return@forEach
      val previous = totals[entry.packageName] ?: 0L
      totals[entry.packageName] = previous + entry.totalTimeInForeground
    }
    return buildBlock(range, totals, sessions = null)
  }

  private fun eventsBlock(days: Int): WritableMap {
    val manager =
      reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val range = dayRange(days.coerceIn(1, 30))
    val events = manager.queryEvents(range.first, range.second)
    val totals = HashMap<String, Long>()
    val sessions = HashMap<String, Int>()
    val openSessions = HashMap<String, Long>()
    val empty = buildBlock(range, totals, sessions)
    empty.putInt("unfinishedSessions", 0)
    if (events == null) return empty
    val event = UsageEvents.Event()
    // ACTIVITY_RESUMED / ACTIVITY_PAUSED share their numeric values with the
    // older MOVE_TO_FOREGROUND / MOVE_TO_BACKGROUND constants, so one pair of
    // branches covers every API level we support.
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val pkg = event.packageName ?: continue
      if (pkg == reactApplicationContext.packageName) continue
      when (event.eventType) {
        UsageEvents.Event.ACTIVITY_RESUMED -> openSessions[pkg] = event.timeStamp
        UsageEvents.Event.ACTIVITY_PAUSED -> {
          val started = openSessions.remove(pkg) ?: continue
          val duration = (event.timeStamp - started).coerceIn(0L, MAX_SESSION_MS)
          totals[pkg] = (totals[pkg] ?: 0L) + duration
          sessions[pkg] = (sessions[pkg] ?: 0) + 1
        }
      }
    }
    val block = buildBlock(range, totals, sessions)
    block.putInt("unfinishedSessions", openSessions.size)
    return block
  }

  private fun buildBlock(
    range: Pair<Long, Long>,
    totals: Map<String, Long>,
    sessions: Map<String, Int>?
  ): WritableMap {
    val minutesByPackage = LinkedHashMap<String, Long>()
    totals.forEach { (pkg, ms) ->
      // Round to the nearest minute; "0 minutes" rows are dropped because they
      // are visually meaningless in a Top 8 list.
      val minutes = (ms + 30_000L) / 60_000L
      if (minutes > 0) minutesByPackage[pkg] = minutes
    }
    val sorted = minutesByPackage.entries.sortedByDescending { it.value }
    val items = Arguments.createArray()
    sorted.forEach { entry ->
      items.pushMap(item(entry.key, entry.value, sessions?.get(entry.key)))
    }
    val top = Arguments.createArray()
    sorted.take(TOP_COUNT).forEach { entry ->
      top.pushMap(item(entry.key, entry.value, sessions?.get(entry.key)))
    }
    val result = Arguments.createMap()
    result.putDouble("from", range.first.toDouble())
    result.putDouble("to", range.second.toDouble())
    result.putInt("days", ((range.second - range.first) / DAY_MS).toInt().coerceAtLeast(1))
    result.putDouble("totalMinutes", sorted.sumOf { it.value }.toDouble())
    result.putArray("items", items)
    result.putArray("top", top)
    return result
  }

  private fun item(pkg: String, minutes: Long, sessions: Int?): WritableMap {
    val map = Arguments.createMap()
    map.putString("pkg", pkg)
    map.putString("label", label(pkg))
    map.putDouble("minutes", minutes.toDouble())
    if (sessions != null) map.putInt("sessions", sessions)
    return map
  }

  private fun label(pkg: String): String {
    synchronized(labelsLock) { labels[pkg]?.let { return it } }
    val resolved =
      runCatching {
          val info =
            reactApplicationContext.packageManager.getApplicationInfo(pkg, PackageManager.GET_META_DATA)
          reactApplicationContext.packageManager.getApplicationLabel(info).toString()
        }
        .getOrDefault(pkg)
    synchronized(labelsLock) { labels[pkg] = resolved }
    return resolved
  }

  /** Start of the first day in the window, and "now". */
  private fun dayRange(days: Int): Pair<Long, Long> {
    val calendar = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      add(Calendar.DAY_OF_YEAR, -(days - 1))
    }
    return calendar.timeInMillis to System.currentTimeMillis()
  }

  private fun hasUsageAccess(): Boolean =
    runCatching {
        val appOps =
          reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        appOps.unsafeCheckOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          Process.myUid(),
          reactApplicationContext.packageName
        ) == AppOpsManager.MODE_ALLOWED
      }
      .getOrDefault(false)

  companion object {
    private const val TOP_COUNT = 8
    private const val DAY_MS = 24L * 60L * 60L * 1000L

    /** A single "session" longer than 6 h is a device-left-on artefact. */
    private const val MAX_SESSION_MS = 6L * 60L * 60L * 1000L
  }
}
