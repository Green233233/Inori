package com.inorinal.qi

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Process
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.io.ByteArrayOutputStream
import java.text.Collator
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

  init { QiUsageReport.attach(this) }
  private val labels = HashMap<String, String>()
  private val labelsLock = Any()

  /** 包名 → 分类 key。分类不随使用数据变化，可以长期缓存。 */
  private val categoryCache = HashMap<String, String>()
  private val categoryLock = Any()

  /** 包名 → 图标 data URL；空串表示这个包确实拿不到图标，避免每次重试。 */
  private val iconCache = HashMap<String, String>()
  private val iconLock = Any()

  override fun getName(): String = "QiUsageStats"

  @ReactMethod
  fun queryUsageStats(interval: String, days: Int, promise: Promise) {
    if (!hasUsageAccess()) {
      promise.reject("usage_permission_missing", "请在设置里授予「使用情况访问」权限")
      return
    }
    io.execute {
      try {
        promise.resolve(QiUsageAggregator.usageBlock(reactApplicationContext, interval, days))
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
        promise.resolve(QiUsageAggregator.eventsBlock(reactApplicationContext, days))
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
        promise.resolve(QiUsageAggregator.aggregate(reactApplicationContext))
      } catch (error: Exception) {
        promise.reject("usage_aggregate_failed", error.message, error)
      }
    }
  }

  /**
   * 单日明细：主人端「使用时长」页与轨迹时间轴用。
   * 全部从使用事件算，和 [hourlyMinutes] 同一套会话切分，避免两个口径打架。
   * 返回 {ok, dayStartMs, totalMinutes, perHour[24], byCategory[], apps[]}，
   * apps 最多 12 个、按分钟降序，icon 是 48dp PNG 的 data URL 或 null。
   */
  @ReactMethod
  fun dayStats(dayStartMs: Double, promise: Promise) {
    if (!hasUsageAccess()) {
      promise.reject("usage_permission_missing", "请在设置里授予「使用情况访问」权限")
      return
    }
    io.execute {
      try {
        promise.resolve(dayStatsBlock(dayStartMs.toLong()))
      } catch (error: Exception) {
        Log.w(TAG, "dayStats failed", error)
        promise.reject("usage_failed", error.message ?: "读取使用数据失败", error)
      }
    }
  }

  /**
   * 最近 [days] 天的每日明细，days 夹在 1..30，days[0] 是今天、往后倒推。
   * 只扫一次事件流再按天分桶，30 天不会变成 30 次数据库遍历。
   */
  @ReactMethod
  fun rangeStats(days: Int, promise: Promise) {
    if (!hasUsageAccess()) {
      promise.reject("usage_permission_missing", "请在设置里授予「使用情况访问」权限")
      return
    }
    io.execute {
      try {
        promise.resolve(rangeStatsBlock(days))
      } catch (error: Exception) {
        Log.w(TAG, "rangeStats failed", error)
        promise.reject("usage_failed", error.message ?: "读取使用数据失败", error)
      }
    }
  }

  /**
   * 会话列表：ACTIVITY_RESUMED / ACTIVITY_PAUSED 同包配对。
   * 跨查询窗口的会话裁剪到窗口内并标记 open=true，单次时长上限 6 小时，
   * 按 startMs 升序返回，最多 2000 条。
   */
  @ReactMethod
  fun sessions(fromMs: Double, toMs: Double, promise: Promise) {
    if (!hasUsageAccess()) {
      promise.reject("usage_permission_missing", "请在设置里授予「使用情况访问」权限")
      return
    }
    io.execute {
      try {
        promise.resolve(sessionsBlock(fromMs.toLong(), toMs.toLong()))
      } catch (error: Exception) {
        Log.w(TAG, "sessions failed", error)
        promise.reject("usage_failed", error.message ?: "读取使用数据失败", error)
      }
    }
  }

  /**
   * 可启动应用列表（不是「全部已安装包」）。
   * 只用 queryIntentActivities(MAIN/LAUNCHER) 解析桌面图标，包可见性靠
   * AndroidManifest 里的 <queries> 声明，不走 QUERY_ALL_PACKAGES。
   */
  @ReactMethod
  fun installedApps(promise: Promise) {
    io.execute {
      try {
        promise.resolve(installedAppsBlock())
      } catch (error: Exception) {
        Log.w(TAG, "installedApps failed", error)
        promise.reject("usage_failed", error.message ?: "读取应用列表失败", error)
      }
    }
  }

  // 原生指令通道（QiLinkService）复用同一套聚合，避免两套口径。
  internal fun linkDayStats(dayStartMs: Long): WritableMap = dayStatsBlock(dayStartMs)

  internal fun linkRangeStats(days: Int): WritableMap = rangeStatsBlock(days)

  internal fun linkSessions(fromMs: Long, toMs: Long): WritableMap = sessionsBlock(fromMs, toMs)

  override fun invalidate() {
    QiUsageReport.detach()
    super.invalidate()
  }

  // ---------------------------------------------------------------- internals

  private fun hasUsageAccess(): Boolean =
    QiUsageAggregator.hasUsageAccess(reactApplicationContext)

  private fun label(pkg: String): String =
    QiUsageAggregator.label(reactApplicationContext, pkg)

  // ------------------------------------------------------- P1 使用数据层

  /** 单日结果。dayStartMs 归一到本地零点；未来日期返回一份全 0 结构。 */
  private fun dayStatsBlock(dayStartMs: Long): WritableMap {
    val dayStart = startOfDay(dayStartMs)
    val bucket = DayBucket(dayStart)
    val end = minOf(dayStart + DAY_MS, System.currentTimeMillis())
    if (end > dayStart) collectDays(dayStart, end, listOf(bucket))
    val result = buildDayMap(bucket)
    result.putDouble("dayStartMs", dayStart.toDouble())
    return result
  }

  private fun rangeStatsBlock(days: Int): WritableMap {
    val count = days.coerceIn(1, 30)
    val starts = dayStarts(count)
    val buckets = starts.map { DayBucket(it) }
    collectDays(starts.first(), System.currentTimeMillis(), buckets)
    var totalMinutes = 0L
    val list = Arguments.createArray()
    // 从今天往前排：days[0] 是今天，数组最后一个元素是最早的一天
    for (index in buckets.indices.reversed()) {
      // buildDayMap 的结果 pushMap 之后会被消费，totalMinutes 必须先读出来
      val dayMap = buildDayMap(buckets[index])
      dayMap.putDouble("dayStartMs", buckets[index].dayStartMs.toDouble())
      totalMinutes += dayMap.getDouble("totalMinutes").toLong()
      list.pushMap(dayMap)
    }
    val result = Arguments.createMap()
    result.putBoolean("ok", true)
    result.putDouble("totalMinutes", totalMinutes.toDouble())
    result.putArray("days", list)
    return result
  }

  /**
   * 扫一次 [fromMs, toMs) 的事件流，把每个会话按小时/按天/按包名切进 buckets。
   * 一次扫描服务 1..30 天，避免 rangeStats 对每一天各开一次数据库游标。
   */
  private fun collectDays(fromMs: Long, toMs: Long, buckets: List<DayBucket>) {
    if (buckets.isEmpty()) return
    val events = usageManager().queryEvents(fromMs, toMs)
    val open = HashMap<String, Long>()
    if (events != null) {
      val event = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val pkg = event.packageName ?: continue
        if (pkg.isEmpty() || pkg == reactApplicationContext.packageName) continue
        when (event.eventType) {
          UsageEvents.Event.ACTIVITY_RESUMED -> open[pkg] = event.timeStamp
          UsageEvents.Event.ACTIVITY_PAUSED -> {
            val started = open.remove(pkg) ?: continue
            addSession(buckets, pkg, started, event.timeStamp)
          }
        }
      }
    }
    // 窗口结束时还在前台的应用记到窗口末尾（内部按 6 小时截断）
    val end = minOf(System.currentTimeMillis(), toMs)
    open.forEach { (pkg, started) -> addSession(buckets, pkg, started, end) }
  }

  /**
   * 一个会话可能跨小时、跨天：按 [DayBucket] 与小时边界切片累加。
   * 时长按切片记到各自那天（跨零点会话两天各拿自己那段），
   * 会话次数只记在「开始那一天」，避免同一次打开被算两次。
   */
  private fun addSession(buckets: List<DayBucket>, pkg: String, startedAt: Long, endedAt: Long) {
    val end = minOf(endedAt, startedAt + MAX_SESSION_MS)
    if (end <= startedAt) return
    var cursor = startedAt
    while (cursor < end) {
      val index = dayIndexAt(buckets, cursor) ?: break
      val day = buckets[index]
      val dayEnd =
        if (index + 1 < buckets.size) buckets[index + 1].dayStartMs else day.dayStartMs + DAY_MS
      val sliceEnd = minOf(end, dayEnd)
      if (sliceEnd <= cursor) break
      val hour = (((cursor - day.dayStartMs) / HOUR_MS).toInt()).coerceIn(0, 23)
      val hourEnd = day.dayStartMs + (hour + 1) * HOUR_MS
      val hourSliceEnd = minOf(sliceEnd, hourEnd)
      val slice = hourSliceEnd - cursor
      day.hourMs[hour] += slice
      day.msByPackage[pkg] = (day.msByPackage[pkg] ?: 0L) + slice
      cursor = hourSliceEnd
    }
    val startIndex = dayIndexAt(buckets, startedAt) ?: return
    val startDay = buckets[startIndex]
    startDay.sessionsByPackage[pkg] = (startDay.sessionsByPackage[pkg] ?: 0) + 1
  }

  /** buckets 按 dayStartMs 升序，二分找到包含 [time] 的那一天。 */
  private fun dayIndexAt(buckets: List<DayBucket>, time: Long): Int? {
    var low = 0
    var high = buckets.size - 1
    var found: Int? = null
    while (low <= high) {
      val mid = (low + high) ushr 1
      if (buckets[mid].dayStartMs <= time) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return found
  }

  private fun buildDayMap(bucket: DayBucket): WritableMap {
    val minutesByPackage = LinkedHashMap<String, Long>()
    var totalMinutes = 0L
    bucket.msByPackage.forEach { (pkg, ms) ->
      val minutes = roundMinutes(ms)
      if (minutes > 0) {
        minutesByPackage[pkg] = minutes
        totalMinutes += minutes
      }
    }
    val sorted = minutesByPackage.entries.sortedByDescending { it.value }

    // 分类用全部应用累加：apps 只展示前 12，分类占比仍然要完整
    val minutesByCategory = LinkedHashMap<String, Long>()
    sorted.forEach { entry ->
      val key = categoryOf(entry.key)
      minutesByCategory[key] = (minutesByCategory[key] ?: 0L) + entry.value
    }

    val apps = Arguments.createArray()
    sorted.take(TOP_APP_COUNT).forEach { entry ->
      val map = Arguments.createMap()
      map.putString("pkg", entry.key)
      map.putString("label", label(entry.key))
      map.putDouble("minutes", entry.value.toDouble())
      map.putInt("sessions", bucket.sessionsByPackage[entry.key] ?: 0)
      val icon = iconOf(entry.key)
      if (icon == null) map.putNull("icon") else map.putString("icon", icon)
      apps.pushMap(map)
    }

    val categories = Arguments.createArray()
    minutesByCategory.entries
      .filter { it.value > 0 }
      .sortedByDescending { it.value }
      .forEach { entry ->
        val map = Arguments.createMap()
        map.putString("key", entry.key)
        map.putString("label", categoryLabel(entry.key))
        map.putDouble("minutes", entry.value.toDouble())
        categories.pushMap(map)
      }

    val result = Arguments.createMap()
    result.putBoolean("ok", true)
    result.putDouble("totalMinutes", totalMinutes.toDouble())
    result.putArray("perHour", hourArray(bucket))
    result.putArray("byCategory", categories)
    result.putArray("apps", apps)
    return result
  }

  private fun hourArray(bucket: DayBucket): WritableArray {
    val out = Arguments.createArray()
    for (hour in 0 until 24) out.pushInt(roundMinutes(bucket.hourMs[hour]).toInt())
    return out
  }

  /** 分类按包名缓存：一天最多 12 个应用，30 天页面也不会反复查 PackageManager。 */
  private fun categoryOf(pkg: String): String {
    synchronized(categoryLock) { categoryCache[pkg]?.let { return it } }
    val key =
      runCatching {
          val info = reactApplicationContext.packageManager.getApplicationInfo(pkg, 0)
          categoryKey(info)
        }
        .getOrDefault(CATEGORY_UNCATEGORIZED)
    synchronized(categoryLock) { categoryCache[pkg] = key }
    return key
  }

  /**
   * ApplicationInfo.category → 固定 6 个分类（key / 中文标签）：
   * social/社交通讯、media/影音娱乐、music/音乐电台、game/游戏、
   * tools/工具、uncategorized/未分类。
   *
   * 取舍说明：
   *  - CATEGORY_IMAGE 并入 media（相册、修图都算影音娱乐），不单列；
   *  - CATEGORY_NEWS 并入 tools：资讯类通常只有几分钟，单列会碎成一堆 1 分钟分类；
   *  - CATEGORY_MAPS 并入 tools：导航/地图在家长视角属于工具；
   *  - 其余（含 CATEGORY_UNDEFINED）一律归 uncategorized。
   */
  private fun categoryKey(info: ApplicationInfo): String {
    // ApplicationInfo.category 从 API 26 才有，更老的系统统一算未分类
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return CATEGORY_UNCATEGORIZED
    return when (info.category) {
      ApplicationInfo.CATEGORY_SOCIAL -> CATEGORY_SOCIAL
      ApplicationInfo.CATEGORY_VIDEO,
      ApplicationInfo.CATEGORY_IMAGE -> CATEGORY_MEDIA
      ApplicationInfo.CATEGORY_AUDIO -> CATEGORY_MUSIC
      ApplicationInfo.CATEGORY_GAME -> CATEGORY_GAME
      ApplicationInfo.CATEGORY_PRODUCTIVITY,
      ApplicationInfo.CATEGORY_MAPS,
      ApplicationInfo.CATEGORY_NEWS -> CATEGORY_TOOLS
      else -> CATEGORY_UNCATEGORIZED
    }
  }

  private fun categoryLabel(key: String): String =
    when (key) {
      CATEGORY_SOCIAL -> "社交通讯"
      CATEGORY_MEDIA -> "影音娱乐"
      CATEGORY_MUSIC -> "音乐电台"
      CATEGORY_GAME -> "游戏"
      CATEGORY_TOOLS -> "工具"
      else -> "未分类"
    }

  private fun sessionsBlock(fromMs: Long, toMs: Long): WritableMap {
    val from = minOf(fromMs, toMs)
    val to = maxOf(fromMs, toMs)
    val found = ArrayList<UsageSessionEntry>()
    val events = usageManager().queryEvents(from, to)
    val open = HashMap<String, Long>()
    if (events != null) {
      val event = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val pkg = event.packageName ?: continue
        // 自己（祈）不算，空包名是系统事件的占位
        if (pkg.isEmpty() || pkg == reactApplicationContext.packageName) continue
        when (event.eventType) {
          UsageEvents.Event.ACTIVITY_RESUMED -> open[pkg] = event.timeStamp
          UsageEvents.Event.ACTIVITY_PAUSED -> {
            val started = open.remove(pkg) ?: continue
            appendSession(found, pkg, started, event.timeStamp, open = false, fromMs = from, toMs = to)
          }
        }
      }
    }
    // 窗口结束时还没等到 ACTIVITY_PAUSED：裁剪到窗口末尾并标记 open
    val end = minOf(System.currentTimeMillis(), to)
    open.forEach { (pkg, started) ->
      appendSession(found, pkg, started, end, open = true, fromMs = from, toMs = to)
    }
    found.sortBy { it.startMs }
    val list = Arguments.createArray()
    found.take(MAX_SESSION_COUNT).forEach { session ->
      val map = Arguments.createMap()
      map.putString("pkg", session.pkg)
      map.putString("label", label(session.pkg))
      map.putDouble("startMs", session.startMs.toDouble())
      map.putDouble("endMs", session.endMs.toDouble())
      // 会话可能只有几十秒，分钟保留一位小数
      map.putDouble("minutes", Math.round((session.endMs - session.startMs) / 6000.0) / 10.0)
      map.putBoolean("open", session.open)
      list.pushMap(map)
    }
    val result = Arguments.createMap()
    result.putBoolean("ok", true)
    result.putArray("sessions", list)
    return result
  }

  /** 会话裁剪到查询窗口内，并按 6 小时上限截断（和 [eventsBlock] 的口径一致）。 */
  private fun appendSession(
    out: MutableList<UsageSessionEntry>,
    pkg: String,
    startedAt: Long,
    endedAt: Long,
    open: Boolean,
    fromMs: Long,
    toMs: Long
  ) {
    val start = maxOf(startedAt, fromMs)
    var end = minOf(endedAt, toMs)
    if (end - start > MAX_SESSION_MS) end = start + MAX_SESSION_MS
    if (end <= start) return
    out.add(UsageSessionEntry(pkg, start, end, open))
  }

  /**
   * 可启动应用列表。只用 queryIntentActivities(MAIN/LAUNCHER)，不枚举全部已安装包：
   * Android 11+ 的包可见性由 AndroidManifest 的 <queries> 声明提供，因此不需要
   * QUERY_ALL_PACKAGES（那是商店敏感权限，会带来额外审核）。
   */
  private fun installedAppsBlock(): WritableMap {
    val pm = reactApplicationContext.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved = pm.queryIntentActivities(intent, 0) ?: emptyList()
    val seen = HashSet<String>()
    val entries = ArrayList<LaunchableApp>()
    resolved.forEach { info ->
      val activity = info.activityInfo ?: return@forEach
      val pkg = activity.packageName ?: return@forEach
      // 一个包可能有多个启动入口，按包名去重
      if (pkg.isEmpty() || !seen.add(pkg)) return@forEach
      val label =
        runCatching { pm.getApplicationLabel(activity.applicationInfo).toString() }
          .getOrDefault(label(pkg))
      entries.add(LaunchableApp(pkg, label))
    }
    // 按系统语言排序，中文环境下是拼音序，比按包名排更好找
    val collator = Collator.getInstance()
    entries.sortWith(compareBy(collator) { it.label })
    val apps = Arguments.createArray()
    entries.forEach { app ->
      val map = Arguments.createMap()
      map.putString("pkg", app.pkg)
      map.putString("label", app.label)
      // 这个列表本身就是从 LAUNCHER intent 解析出来的，所以一定可启动
      map.putBoolean("launchable", true)
      val icon = iconOf(app.pkg)
      if (icon == null) map.putNull("icon") else map.putString("icon", icon)
      apps.pushMap(map)
    }
    val result = Arguments.createMap()
    result.putBoolean("ok", true)
    result.putArray("apps", apps)
    return result
  }

  private fun iconOf(pkg: String): String? {
    synchronized(iconLock) { iconCache[pkg]?.let { cached -> return cached.ifEmpty { null } } }
    val data = runCatching { encodeIcon(pkg) }.getOrNull()
    synchronized(iconLock) { iconCache[pkg] = data ?: "" }
    return data
  }

  /**
   * 48dp 图标 → PNG → data URL。单张必须小于 8KB，超了就逐级减半；
   * 最小 16px 仍超标时返回 null（宁可没有图标，也不要把命令包撑爆）。
   */
  private fun encodeIcon(pkg: String): String? {
    val source = drawableToBitmap(reactApplicationContext.packageManager.getApplicationIcon(pkg))
    val density = reactApplicationContext.resources.displayMetrics.density
    var size = (ICON_DP * density).toInt().coerceAtLeast(ICON_MIN_PX)
    try {
      while (size >= ICON_MIN_PX) {
        val scaled =
          if (size == source.bitmap.width && size == source.bitmap.height) {
            source.bitmap
          } else {
            Bitmap.createScaledBitmap(source.bitmap, size, size, true)
          }
        val bytes =
          ByteArrayOutputStream().also { out ->
            scaled.compress(Bitmap.CompressFormat.PNG, 100, out)
          }.toByteArray()
        if (scaled !== source.bitmap) scaled.recycle()
        if (bytes.size <= ICON_MAX_BYTES) {
          return "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        }
        size /= 2
      }
      return null
    } finally {
      // BitmapDrawable 的位图由 PackageManager 缓存持有，只有自建的才能回收
      if (source.owned) source.bitmap.recycle()
    }
  }

  private fun drawableToBitmap(drawable: Drawable): IconBitmap {
    val shared = (drawable as? BitmapDrawable)?.bitmap
    if (shared != null) return IconBitmap(shared, owned = false)
    val width = drawable.intrinsicWidth.coerceAtLeast(1)
    val height = drawable.intrinsicHeight.coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    drawable.setBounds(0, 0, width, height)
    drawable.draw(Canvas(bitmap))
    return IconBitmap(bitmap, owned = true)
  }

  private fun startOfDay(timeMs: Long): Long =
    Calendar.getInstance()
      .apply {
        timeInMillis = timeMs
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
      }
      .timeInMillis

  /** 升序的每日零点，最后一个元素是今天。 */
  private fun dayStarts(days: Int): List<Long> {
    val today = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    val out = ArrayList<Long>(days)
    for (offset in days - 1 downTo 0) {
      val day = today.clone() as Calendar
      day.add(Calendar.DAY_OF_YEAR, -offset)
      out.add(day.timeInMillis)
    }
    return out
  }

  private fun usageManager(): UsageStatsManager =
    reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

  /** 毫秒 → 分钟，四舍五入（和现有 Top 8 列表同一个口径）。 */
  private fun roundMinutes(ms: Long): Long = (ms + 30_000L) / 60_000L

  private class DayBucket(val dayStartMs: Long) {
    val msByPackage = HashMap<String, Long>()
    val sessionsByPackage = HashMap<String, Int>()
    val hourMs = LongArray(24)
  }

  private class UsageSessionEntry(
    val pkg: String,
    val startMs: Long,
    val endMs: Long,
    val open: Boolean
  )

  private class LaunchableApp(val pkg: String, val label: String)

  private class IconBitmap(val bitmap: Bitmap, val owned: Boolean)

  internal companion object {
    private const val TAG = "QiUsageStats"
    internal const val TOP_COUNT = 8

    /** dayStats / rangeStats 的 apps 列表上限：12 个够看，再多就是噪音。 */
    private const val TOP_APP_COUNT = 12

    /** sessions() 单次最多返回的会话数，避免一条命令塞进几十万条事件。 */
    private const val MAX_SESSION_COUNT = 2000

    internal const val DAY_MS = 24L * 60L * 60L * 1000L
    internal const val HOUR_MS = 60L * 60L * 1000L

    /** A single "session" longer than 6 h is a device-left-on artefact. */
    internal const val MAX_SESSION_MS = 6L * 60L * 60L * 1000L

    /** 图标按 48dp 取像素尺寸，最小缩到 16px。 */
    private const val ICON_DP = 48
    private const val ICON_MIN_PX = 16

    /** PNG 单张上限 8KB：12 张图标 + 其它字段要能塞进一条 relay 命令。 */
    private const val ICON_MAX_BYTES = 8 * 1024

    // byCategory 的固定 key，顺序与 README 约定一致
    private const val CATEGORY_SOCIAL = "social"
    private const val CATEGORY_MEDIA = "media"
    private const val CATEGORY_MUSIC = "music"
    private const val CATEGORY_GAME = "game"
    private const val CATEGORY_TOOLS = "tools"
    private const val CATEGORY_UNCATEGORIZED = "uncategorized"
  }
}

/**
 * 使用数据的聚合核心，和 [UsageStatsModule.aggregate] 共用同一份实现，但不
 * 依赖 React bridge：小狗端的常驻服务要在没有 JS 的情况下回答 `usage.stats`，
 * 否则主人端点「使用时长」只会得到一个 40 秒的超时。
 *
 * 只搬聚合链路（today / week / events / top / hours）；明细页与图标编码仍留在
 * 模块里，服务进程不碰 Bitmap。
 */
internal object QiUsageAggregator {
  /** 包名 → 应用名；模块与服务共用一个缓存，避免各查一遍 PackageManager。 */
  private val labels = HashMap<String, String>()
  private val labelsLock = Any()

  internal fun hasUsageAccess(context: Context): Boolean =
    runCatching {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        appOps.unsafeCheckOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          Process.myUid(),
          context.packageName
        ) == AppOpsManager.MODE_ALLOWED
      }
      .getOrDefault(false)

  internal fun label(context: Context, pkg: String): String {
    synchronized(labelsLock) { labels[pkg]?.let { return it } }
    val resolved =
      runCatching {
          val info =
            context.packageManager.getApplicationInfo(pkg, PackageManager.GET_META_DATA)
          context.packageManager.getApplicationLabel(info).toString()
        }
        .getOrDefault(pkg)
    synchronized(labelsLock) { labels[pkg] = resolved }
    return resolved
  }

  /** One call for the home screen: today + 7 days + top 8. */
  internal fun aggregate(context: Context): WritableMap {
    val today = usageBlock(context, "daily", 1)
    val week = usageBlock(context, "daily", 7)
    val events = eventsBlock(context, 7)
    // Read the array before putMap: WritableMap.putMap consumes the child map,
    // and reading it afterwards throws "Map already consumed".
    val hours = hourlyMinutes(context)
    val top = today.getArray("top")
    val result = Arguments.createMap()
    result.putMap("today", today)
    result.putMap("week", week)
    result.putMap("events", events)
    result.putArray("top", top ?: Arguments.createArray())
    result.putArray("hours", hours)
    result.putDouble("generatedAt", System.currentTimeMillis().toDouble())
    return result
  }

  internal fun usageBlock(context: Context, interval: String, days: Int): WritableMap {
    val manager =
      context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
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
      if (entry.packageName == context.packageName) return@forEach
      val previous = totals[entry.packageName] ?: 0L
      totals[entry.packageName] = previous + entry.totalTimeInForeground
    }
    return buildBlock(context, range, totals, sessions = null)
  }

  /**
   * 今天 0-23 点每小时的屏幕时长（分钟）。用使用事件把会话按小时切段累加，
   * 只读一次事件流，不额外唤醒任何东西。
   */
  internal fun hourlyMinutes(context: Context): WritableArray {
    val out = Arguments.createArray()
    val buckets = LongArray(24)
    val manager =
      context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val startOfDay =
      Calendar.getInstance()
        .apply {
          set(Calendar.HOUR_OF_DAY, 0)
          set(Calendar.MINUTE, 0)
          set(Calendar.SECOND, 0)
          set(Calendar.MILLISECOND, 0)
        }
        .timeInMillis
    val now = System.currentTimeMillis()
    val events = manager.queryEvents(startOfDay, now)
    if (events != null) {
      val event = UsageEvents.Event()
      val open = HashMap<String, Long>()
      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        val pkg = event.packageName ?: continue
        if (pkg == context.packageName) continue
        when (event.eventType) {
          UsageEvents.Event.ACTIVITY_RESUMED -> open[pkg] = event.timeStamp
          UsageEvents.Event.ACTIVITY_PAUSED -> {
            val started = open.remove(pkg) ?: continue
            val duration =
              (event.timeStamp - started).coerceIn(0L, UsageStatsModule.MAX_SESSION_MS)
            addToBuckets(buckets, started, duration, startOfDay)
          }
        }
      }
      // 仍在使用的会话记到当前时刻
      open.values.forEach { started ->
        addToBuckets(
          buckets,
          started,
          (now - started).coerceIn(0L, UsageStatsModule.MAX_SESSION_MS),
          startOfDay
        )
      }
    }
    for (i in 0 until 24) {
      val map = Arguments.createMap()
      map.putInt("hour", i)
      map.putInt("minutes", (buckets[i] / 60_000L).toInt())
      out.pushMap(map)
    }
    return out
  }

  private fun addToBuckets(buckets: LongArray, started: Long, duration: Long, startOfDay: Long) {
    var cursor = started
    val end = started + duration
    while (cursor < end) {
      val hourIndex = (((cursor - startOfDay) / UsageStatsModule.HOUR_MS).toInt()).coerceIn(0, 23)
      val hourEnd = startOfDay + (hourIndex + 1) * UsageStatsModule.HOUR_MS
      val sliceEnd = minOf(end, hourEnd)
      buckets[hourIndex] += (sliceEnd - cursor)
      cursor = sliceEnd
    }
  }

  internal fun eventsBlock(context: Context, days: Int): WritableMap {
    val manager =
      context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val range = dayRange(days.coerceIn(1, 30))
    val events = manager.queryEvents(range.first, range.second)
    val totals = HashMap<String, Long>()
    val sessions = HashMap<String, Int>()
    val openSessions = HashMap<String, Long>()
    val empty = buildBlock(context, range, totals, sessions)
    empty.putInt("unfinishedSessions", 0)
    if (events == null) return empty
    val event = UsageEvents.Event()
    // ACTIVITY_RESUMED / ACTIVITY_PAUSED share their numeric values with the
    // older MOVE_TO_FOREGROUND / MOVE_TO_BACKGROUND constants, so one pair of
    // branches covers every API level we support.
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val pkg = event.packageName ?: continue
      if (pkg == context.packageName) continue
      when (event.eventType) {
        UsageEvents.Event.ACTIVITY_RESUMED -> openSessions[pkg] = event.timeStamp
        UsageEvents.Event.ACTIVITY_PAUSED -> {
          val started = openSessions.remove(pkg) ?: continue
          val duration =
            (event.timeStamp - started).coerceIn(0L, UsageStatsModule.MAX_SESSION_MS)
          totals[pkg] = (totals[pkg] ?: 0L) + duration
          sessions[pkg] = (sessions[pkg] ?: 0) + 1
        }
      }
    }
    val block = buildBlock(context, range, totals, sessions)
    block.putInt("unfinishedSessions", openSessions.size)
    return block
  }

  private fun buildBlock(
    context: Context,
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
      items.pushMap(item(context, entry.key, entry.value, sessions?.get(entry.key)))
    }
    val top = Arguments.createArray()
    sorted.take(UsageStatsModule.TOP_COUNT).forEach { entry ->
      top.pushMap(item(context, entry.key, entry.value, sessions?.get(entry.key)))
    }
    val result = Arguments.createMap()
    result.putDouble("from", range.first.toDouble())
    result.putDouble("to", range.second.toDouble())
    result.putInt(
      "days",
      ((range.second - range.first) / UsageStatsModule.DAY_MS).toInt().coerceAtLeast(1)
    )
    result.putDouble("totalMinutes", sorted.sumOf { it.value }.toDouble())
    result.putArray("items", items)
    result.putArray("top", top)
    return result
  }

  private fun item(context: Context, pkg: String, minutes: Long, sessions: Int?): WritableMap {
    val map = Arguments.createMap()
    map.putString("pkg", pkg)
    map.putString("label", label(context, pkg))
    map.putDouble("minutes", minutes.toDouble())
    if (sessions != null) map.putInt("sessions", sessions)
    return map
  }

  /** Start of the first day in the window, and "now". */
  private fun dayRange(days: Int): Pair<Long, Long> {
    val calendar =
      Calendar.getInstance()
        .apply {
          set(Calendar.HOUR_OF_DAY, 0)
          set(Calendar.MINUTE, 0)
          set(Calendar.SECOND, 0)
          set(Calendar.MILLISECOND, 0)
          add(Calendar.DAY_OF_YEAR, -(days - 1))
        }
    return calendar.timeInMillis to System.currentTimeMillis()
  }
}

/**
 * 原生指令通道用的聚合入口。
 *
 * RN 模块实例由 QiPackage 在 App 启动时创建并长期存活，这里只持一个引用，
 * 让 QiLinkService 能直接用同一套「按事件流切会话」的实现回包，
 * 不必把 600 行统计逻辑再抄一遍。
 */
internal object QiUsageReport {
  @Volatile private var module: UsageStatsModule? = null

  fun attach(instance: UsageStatsModule) {
    module = instance
  }

  fun detach() {
    module = null
  }

  private fun require(): UsageStatsModule =
    module ?: throw IllegalStateException("使用数据模块还没准备好，请先打开一次祈")

  fun day(dayStartMs: Long): WritableMap = require().linkDayStats(dayStartMs)

  fun range(days: Int): WritableMap = require().linkRangeStats(days)

  fun sessions(fromMs: Long, toMs: Long): WritableMap = require().linkSessions(fromMs, toMs)
}
