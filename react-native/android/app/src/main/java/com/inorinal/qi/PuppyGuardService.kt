package com.inorinal.qi

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.media.projection.MediaProjectionManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.util.Calendar
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import org.json.JSONArray
import org.json.JSONObject

/**
 * The only resident component of 祈.
 *
 * Responsibilities:
 *  - hold one foreground service so the process stays alive between app opens;
 *  - run ONE blocking wait loop whose interval comes from [PowerGovernor];
 *  - keep the screen/charging state fresh from broadcasts;
 *  - hold the MediaProjection token for standing capture on API 29-33, because
 *    Android 14+ forbids that pattern and needs a per-capture consent instead.
 *
 * Explicit non-goals, so nobody "optimises" them back in later:
 *  - no WakeLock: the wait itself is the scheduler, waking the device to poll
 *    would defeat the point of the adaptive cadence;
 *  - no AlarmManager / JobScheduler / periodic timers: those are the canonical
 *    Doze-breaking patterns for a companion app;
 *  - no network here: JS owns the long poll (it already has the sealed
 *    transport), the service only decides *when* the next poll should start.
 */
class PuppyGuardService : Service() {

  private val powered = AtomicBoolean(false)
  private var loopThread: Thread? = null
  // A lock + condition instead of Thread.sleep: the screen/battery broadcast can
  // signal an immediate re-decision, so the loop never finishes a stale 25 s
  // wait after the phone has already been locked.
  private val loopLock = ReentrantLock()
  private val loopSignal = loopLock.newCondition()
  private var receiver: BroadcastReceiver? = null

  private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    lastEventAt = SystemClock.elapsedRealtime()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        shutdown()
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_PROJECTION -> {
        ensureForeground(baselineType())
        beginProjection(
          intent.getIntExtra(EXTRA_RESULT_CODE, 0),
          projectionIntent(intent),
        )
      }
      ACTION_END_PROJECTION -> {
        endProjectionInternal(demote = true)
      }
      else -> ensureForeground(baselineType())
    }
    // Foreground is up before the loop starts: the loop may block for minutes.
    ensureForeground(if (projectionActive) baselineType() or MEDIA_PROJECTION_TYPE else baselineType())
    startLoop()
    registerReceivers()
    running = true
    startedAt = System.currentTimeMillis()
    wakeLoop()
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    shutdown()
    instance = null
    super.onDestroy()
  }

  /** Swiping the app away must not silently end the guard. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    // START_STICKY + a live foreground notification is the whole contract here;
    // the guard keeps running and JS re-attaches on next launch.
    super.onTaskRemoved(rootIntent)
  }

  // ------------------------------------------------------------- lifecycle

  private fun shutdown() {
    running = false
    powered.set(false)
    wakeLoop()
    loopThread?.let { thread ->
      runCatching { thread.join(1_000) }
    }
    loopThread = null
    unregisterReceivers()
    endProjectionInternal(demote = false)
  }

  private fun startLoop() {
    if (loopThread?.isAlive == true) return
    powered.set(true)
    loopThread =
      Thread({ longPollLoop() }, "qi-guard-loop").apply {
        // Low priority: this thread sleeps almost all the time and must never
        // compete with the UI or the JS thread when it wakes up.
        priority = Thread.MIN_PRIORITY
        isDaemon = true
        start()
      }
  }

  /**
   * One blocking wait per iteration, no timer objects.
   *
   * `wait()` (instead of `sleep()`) is deliberate: [stop] and the screen/battery
   * broadcasts notify the same monitor, so the interval can be recomputed
   * immediately when the situation changes (e.g. screen just turned off) instead
   * of finishing a stale 25 s sleep first.
   */
  private fun longPollLoop() {
    while (powered.get()) {
      val state = currentState()
      val requested = currentTier()
      tier = PowerGovernor.effectiveTier(state, requested)
      val wait = PowerGovernor.decide(state, tier)
      nextWaitMs = wait
      lastState = state
      blockFor(wait)
      if (!powered.get()) break
      lastTickAt = SystemClock.elapsedRealtime()
      // Recompute at tick time: the wait may have been cut short by a screen or
      // battery broadcast, so the snapshot taken before the wait could be stale.
      dispatchTick()
    }
  }

  /** One blocking wait; the only thing that ever pauses this thread. */
  private fun blockFor(waitMs: Long) {
    loopLock.lock()
    try {
      loopSignal.await(waitMs, TimeUnit.MILLISECONDS)
    } catch (interrupted: InterruptedException) {
      Thread.currentThread().interrupt()
    } finally {
      loopLock.unlock()
    }
  }

  private fun wakeLoop() {
    loopLock.lock()
    try {
      loopSignal.signalAll()
    } finally {
      loopLock.unlock()
    }
  }

  private fun dispatchTick() {
    runCatching { applyAutoRules(this) }
    val state = currentState()
    lastState = state
    // 定期位置采样挂在心跳上：没有额外定时器，也不会把循环唤醒得更频繁。
    runCatching { maybeSampleLocation(state) }
    val payload =
      linkedMapOf<String, Any?>(
        "waitMs" to nextWaitMs,
        "tier" to tier.name.lowercase(),
        "screenOn" to state.screenOn,
        "charging" to state.charging,
        "batteryPercent" to state.batteryPercent,
        "idleMinutes" to state.idleMinutes,
        "at" to System.currentTimeMillis(),
      )
    // JS may be gone (process kept alive by the FGS): the listener is optional
    // and the loop never blocks on it.
    runCatching { tickListener?.invoke(payload) }
  }

  // ----------------------------------------------------------------- state

  private fun currentTier(): Tier {
    val raw = prefs.getString(PREF_TIER, Tier.BALANCED.name) ?: Tier.BALANCED.name
    return runCatching { Tier.valueOf(raw) }.getOrDefault(Tier.BALANCED)
  }

  private fun currentState(): PowerState {
    val context = this
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    val battery = runCatching {
        context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      }
      .getOrNull()
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val percent =
      if (level >= 0 && scale > 0) (level * 100 / scale) else if (level >= 0) level else -1
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
    val charging =
      plugged != 0 ||
        status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL
    val idleMinutes = ((SystemClock.elapsedRealtime() - lastEventAt) / 60_000L).coerceAtLeast(0L)
    return PowerState(
      screenOn = power.isInteractive,
      userPresent = power.isInteractive,
      charging = charging,
      batteryPercent = percent,
      idleMinutes = idleMinutes
    )
  }

  // ---------------------------------------------------------- notifications

  private fun ensureChannel() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel =
      NotificationChannel(CHANNEL_ID, "祈 · 守护", NotificationManager.IMPORTANCE_MIN).apply {
        description = "常驻但尽量安静：告诉你可以随时在设置里停掉守护"
        setShowBadge(false)
        enableVibration(false)
        setSound(null, null)
        lockscreenVisibility = Notification.VISIBILITY_SECRET
      }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    ensureChannel()
    val open =
      Intent().apply {
        setClassName(packageName, "com.inorinal.MainActivity")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
    val pending =
      PendingIntent.getActivity(
        this,
        0,
        open,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      // System icon keeps the module free of drawable resources; the title is
      // the part the user actually reads, and it states the current mode so the
      // user is never surprised by a silent resident process.
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("祈 · 守护中")
      .setContentText(if (projectionActive) "屏幕共享已开启 · 随时可停" else "受控中 · 只有你允许的事才会发生")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(pending)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  /**
   * API 34 introduced FOREGROUND_SERVICE_TYPE_SPECIAL_USE; older platforms do
   * not know the bit and reject it in startForeground, so it is added only
   * where it exists and mediaProjection is added on top.
   */
  private fun baselineType(): Int =
    if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0

  private fun ensureForeground(type: Int) {
    val notification = buildNotification()
    if (type == 0) {
      startForeground(NOTIFICATION_ID, notification)
    } else {
      startForeground(NOTIFICATION_ID, notification, type)
    }
  }

  // ------------------------------------------------------------ media projection

  /**
   * Consumes a consent token. On Android 14+ this MUST happen after the FGS has
   * been promoted to the mediaProjection type, otherwise the platform throws
   * SecurityException — hence the promote-then-acquire order.
   */
  private fun beginProjection(resultCode: Int, data: Intent?) {
    if (data == null) {
      ProjectionBroker.fail("没有拿到屏幕共享授权数据")
      demoteForeground()
      return
    }
    try {
      ensureForeground(baselineType() or MEDIA_PROJECTION_TYPE)
      val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val projection = manager.getMediaProjection(resultCode, data)
      if (projection == null) {
        ProjectionBroker.fail("屏幕共享授权已失效，请重新授权")
        demoteForeground()
        return
      }
      ProjectionBroker.attach(projection)
      projectionActive = true
      ensureForeground(baselineType() or MEDIA_PROJECTION_TYPE)
      AuditLogModule.write("projection.begin", "屏幕共享已开启", this)
    } catch (error: Exception) {
      ProjectionBroker.fail(describeProjectionError(error))
      AuditLogModule.write("projection.failed", error.javaClass.simpleName, this)
      demoteForeground()
    }
  }

  private fun describeProjectionError(error: Exception): String =
    when (error) {
      is SecurityException -> "系统拒绝了屏幕共享（需要前台服务类型 mediaProjection）"
      is IllegalArgumentException -> "屏幕共享授权无效"
      else -> error.message ?: "屏幕共享失败"
    }

  private fun demoteForeground() {
    projectionActive = false
    runCatching { ensureForeground(baselineType()) }
  }

  private fun endProjectionInternal(demote: Boolean) {
    ProjectionBroker.release()
    projectionActive = false
    if (demote) demoteForeground()
  }

  // ------------------------------------------------------------- broadcasts

  private fun registerReceivers() {
    if (receiver != null) return
    val filter =
      IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_USER_PRESENT)
        addAction(Intent.ACTION_POWER_CONNECTED)
        addAction(Intent.ACTION_POWER_DISCONNECTED)
      }
    // CONNECTIVITY_CHANGE can no longer be received from the manifest for this
    // targetSdk, so the one-shot "catch up after network is back" signal is
    // registered here instead — while a receiver is alive, which is exactly
    // when it matters.
    filter.addAction(CONNECTIVITY_ACTION)
    val broadcastReceiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          when (intent?.action) {
            Intent.ACTION_USER_PRESENT -> {
              userPresentCount += 1
              lastEventAt = SystemClock.elapsedRealtime()
            }
            Intent.ACTION_SCREEN_ON -> {
              // A screen-on is a real user event: it resets the idle clock, so
              // the loop goes back to the fast cadence instead of staying in
              // the 5-minute idle regime.
              lastEventAt = SystemClock.elapsedRealtime()
            }
            CONNECTIVITY_ACTION -> {
              AutoStartReceiver.requestSync(context ?: this@PuppyGuardService, "connectivity")
            }
          }
          wakeLoop()
        }
      }
    receiver = broadcastReceiver
    ContextCompat.registerReceiver(
      this,
      broadcastReceiver,
      filter,
      ContextCompat.RECEIVER_NOT_EXPORTED
    )
  }

  private fun unregisterReceivers() {
    receiver?.let { runCatching { unregisterReceiver(it) } }
    receiver = null
  }

  // ------------------------------------------------------------ location trail

  /**
   * 按功耗档位定期采一个点（SAVER 30 分钟 / BALANCED 10 分钟 / REALTIME 2 分钟）。
   *
   * 挂在 [dispatchTick] 上而不是新开定时器：每次心跳只做几次 SharedPreferences
   * 读取，距离上次采样不够久就直接返回。真正的取点只读 last-known
   * （PASSIVE/NETWORK/GPS 里最新的那个），绝不 requestLocationUpdates，也绝不
   * 申请 wakelock —— 设备醒着（亮屏）才有意义，灭屏时连 last-known 都不读。
   *
   * 注意：没有 ACCESS_BACKGROUND_LOCATION 时，进程不在前台读位置可能抛
   * SecurityException；[runCatching] 在这里是刻意的降级（跳过本次采样），
   * 不能让守护循环因此退出。下一次心跳会再试。
   */
  private fun maybeSampleLocation(state: PowerState) {
    if (!state.screenOn) return
    if (!hasLocationPermission()) return
    val interval = locationIntervalMs(tier)
    val nowElapsed = SystemClock.elapsedRealtime()
    if (nowElapsed - prefs.getLong(PREF_LAST_LOCATION_ELAPSED, 0L) < interval) {
      return
    }
    val manager =
      getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
    val fix = latestKnownLocation(manager) ?: return
    val at = System.currentTimeMillis()
    // 先记时间再写文件：即使写盘失败，也不会每个心跳都重试到发热。
    prefs.edit().putLong(PREF_LAST_LOCATION_ELAPSED, nowElapsed).apply()
    lastLocationAt = at
    appendTrailPoint(at, fix.latitude, fix.longitude)
  }

  private fun hasLocationPermission(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED ||
      ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED

  /** 只读 last-known：不触发任何 provider 请求，代价接近 0。 */
  private fun latestKnownLocation(manager: LocationManager): android.location.Location? =
    listOf(
        LocationManager.PASSIVE_PROVIDER,
        LocationManager.NETWORK_PROVIDER,
        LocationManager.GPS_PROVIDER
      )
      .mapNotNull { provider ->
        runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
      }
      .maxByOrNull { it.time }

  /**
   * 追加一条轨迹并保留最近 [TRAIL_MAX_POINTS] 条。
   *
   * 先写 `.tmp` 再 rename：JS 的 trailStore 随时可能在读这个文件，直接覆盖
   * 有可能让它读到半个 JSON；rename 在同一文件系统内是原子的。
   */
  private fun appendTrailPoint(at: Long, lat: Double, lng: Double) {
    runCatching {
      val dir = File(filesDir, TRAIL_DIR)
      if (!dir.exists() && !dir.mkdirs()) return
      val target = File(dir, TRAIL_FILE)
      val points = JSONArray()
      if (target.exists()) {
        val raw = runCatching { target.readText() }.getOrDefault("")
        val existing =
          runCatching { JSONObject(raw).optJSONArray("points") }.getOrNull()
        if (existing != null) {
          for (index in 0 until existing.length()) {
            if (points.length() >= TRAIL_MAX_POINTS - 1) break
            val point = existing.optJSONObject(index) ?: continue
            points.put(point)
          }
        }
      }
      points.put(
        JSONObject()
          .put("t", at)
          .put("lat", lat)
          .put("lng", lng)
      )
      val root = JSONObject().put("points", points)
      val temp = File(dir, "$TRAIL_FILE.tmp")
      temp.writeText(root.toString())
      if (!temp.renameTo(target)) {
        target.delete()
        temp.renameTo(target)
      }
    }
  }

  // ------------------------------------------------------------------ companion

  companion object {
    const val CHANNEL_ID = "qi.guard"
    const val NOTIFICATION_ID = 0x7101
    const val PREFS = "qi.guard"
    const val PREF_TIER = "tier"

    /**
     * Auto-rule JSON mirrored from JS. Kept as an opaque string so the rule
     * schema can grow without touching the service.
     */
    const val PREF_AUTO_RULES = "autoRules"
    const val PREF_AUTO_ACTIVE = "autoRuleActive"

    /** 上次采样时间（elapsedRealtime，用于跨档位判断间隔；重启后归零无害）。 */
    const val PREF_LAST_LOCATION_ELAPSED = "lastLocationElapsed"

    /** Last applied auto rule id, so switching rules is audited once, not every tick. */
    @Volatile private var appliedRule: String? = null

    /** 后台位置采样的档位间隔：省电 30 分钟、智能 10 分钟、实时 2 分钟。 */
    private const val SAVER_LOCATION_MS = 30L * 60L * 1000L
    private const val BALANCED_LOCATION_MS = 10L * 60L * 1000L
    private const val REALTIME_LOCATION_MS = 2L * 60L * 1000L

    fun locationIntervalMs(tier: Tier): Long =
      when (tier) {
        Tier.SAVER -> SAVER_LOCATION_MS
        Tier.BALANCED -> BALANCED_LOCATION_MS
        Tier.REALTIME -> REALTIME_LOCATION_MS
      }

    /** JS 侧 trailStore 读取并合并 `files/qi/puppy-trail.json`。 */
    const val TRAIL_DIR = "qi"
    const val TRAIL_FILE = "puppy-trail.json"
    const val TRAIL_MAX_POINTS = 200

    /**
     * Evaluate the mirrored rule list and apply the first matching rule's tier.
     * Runs on every tick but the work is a single SharedPreferences read plus a
     * small JSON parse — deliberately no timer, no wake lock, no extra thread.
     */
    fun applyAutoRules(context: Context) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val raw = prefs.getString(PREF_AUTO_RULES, null)
      if (raw.isNullOrBlank()) {
        appliedRule = null
        prefs.edit().remove(PREF_AUTO_ACTIVE).apply()
        return
      }
      val now = Calendar.getInstance()
      val minutes = now.get(Calendar.HOUR_OF_DAY).toInt() * 60 + now.get(Calendar.MINUTE).toInt()
      var matchId: String? = null
      var matchLabel = ""
      var matchTier: Tier? = null
      runCatching {
        val rules = JSONArray(raw)
        for (index in 0 until rules.length()) {
          val rule = rules.optJSONObject(index) ?: continue
          if (!rule.optBoolean("enabled", true)) continue
          val start = parseClock(rule.optString("start", "")) ?: continue
          val end = parseClock(rule.optString("end", "")) ?: continue
          val inWindow = if (start <= end) minutes in start until end else (minutes >= start || minutes < end)
          if (!inWindow) continue
          matchId = rule.optString("id", "rule-$index")
          matchLabel = rule.optString("label", "")
          val tier = rule.optString("tier", "")
          matchTier = if (tier.isBlank()) null else runCatching { Tier.valueOf(tier.uppercase()) }.getOrNull()
          break
        }
      }
      if (matchId != null && matchId != appliedRule) {
        appliedRule = matchId
        prefs.edit().putString(PREF_AUTO_ACTIVE, matchLabel).apply()
        AuditLogModule.write("rule.active", "自动规则生效：$matchLabel", context)
      } else if (matchId == null && appliedRule != null) {
        appliedRule = null
        prefs.edit().remove(PREF_AUTO_ACTIVE).apply()
        AuditLogModule.write("rule.ended", "自动规则已结束", context)
      }
      if (matchTier != null) {
        val current = prefs.getString(PREF_TIER, Tier.BALANCED.name)
        if (current != matchTier.name) {
          prefs.edit().putString(PREF_TIER, matchTier.name).apply()
        }
      }
    }

    /** "22:30" -> 1350. Null on malformed input so one bad rule cannot break the rest. */
    private fun parseClock(text: String): Int? {
      val parts = text.trim().split(":")
      if (parts.size != 2) return null
      val hour = parts[0].toIntOrNull() ?: return null
      val minute = parts[1].toIntOrNull() ?: return null
      if (hour !in 0..23 || minute !in 0..59) return null
      return hour * 60 + minute
    }

    const val ACTION_START = "com.inorinal.qi.guard.START"
    const val ACTION_STOP = "com.inorinal.qi.guard.STOP"
    const val ACTION_PROJECTION = "com.inorinal.qi.guard.PROJECTION"
    const val ACTION_END_PROJECTION = "com.inorinal.qi.guard.END_PROJECTION"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"

    private const val CONNECTIVITY_ACTION = "android.net.conn.CONNECTIVITY_CHANGE"

    /** FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION without an API-level guard on the constant. */
    val MEDIA_PROJECTION_TYPE: Int = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION

    @Volatile private var instance: PuppyGuardService? = null

    // Snapshot fields. Deliberately plain vars (no private set): the instance
    // methods are the only writers in practice, and keeping them writable from
    // the service keeps the read path (JS status) allocation-free.
    @Volatile var running: Boolean = false

    @Volatile var startedAt: Long = 0L

    @Volatile var lastTickAt: Long = 0L

    /** 最近一次后台位置采样的墙钟时间（0 = 还没采过）。 */
    @Volatile var lastLocationAt: Long = 0L

    @Volatile var lastEventAt: Long = SystemClock.elapsedRealtime()

    @Volatile var tier: Tier = Tier.BALANCED

    @Volatile var nextWaitMs: Long = 0L

    @Volatile var lastState: PowerState? = null

    @Volatile var projectionActive: Boolean = false

    /** Counts unlock events since process start: a cheap "is anyone using it" signal. */
    @Volatile var userPresentCount: Long = 0

    /** GuardModule installs this; null when JS is not attached. */
    @Volatile var tickListener: ((Map<String, Any?>) -> Unit)? = null

    fun start(context: Context) {
      runCatching { applyAutoRules(context) }
      val intent = Intent(context, PuppyGuardService::class.java).setAction(ACTION_START)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (error: Exception) {
        // Background-start restrictions (Android 12+) can refuse this from a
        // boot receiver on some ROMs; the user can always start it from the UI.
        runCatching { AuditLog.append(context, "guard.start_blocked", error.javaClass.simpleName) }
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, PuppyGuardService::class.java).setAction(ACTION_STOP)
      val delivered = runCatching { context.startService(intent) }.isSuccess
      if (!delivered) runCatching { context.stopService(Intent(context, PuppyGuardService::class.java)) }
    }

    fun startProjection(context: Context, resultCode: Int, data: Intent) {
      val intent =
        Intent(context, PuppyGuardService::class.java)
          .setAction(ACTION_PROJECTION)
          .putExtra(EXTRA_RESULT_CODE, resultCode)
          .putExtra(EXTRA_RESULT_DATA, data)
      ContextCompat.startForegroundService(context, intent)
    }

    fun endProjection(context: Context) {
      val intent = Intent(context, PuppyGuardService::class.java).setAction(ACTION_END_PROJECTION)
      runCatching { context.startService(intent) }
    }

    /** Marks "something happened" so the idle timer restarts. */
    fun notifyActivity() {
      lastEventAt = SystemClock.elapsedRealtime()
    }

    fun snapshot(context: Context): Map<String, Any?> {
      val state = lastState ?: PowerState(false, false, false, -1, 0L)
      return linkedMapOf(
        "running" to running,
        "tier" to tier.name.lowercase(),
        "waitMs" to nextWaitMs,
        "screenOn" to state.screenOn,
        "charging" to state.charging,
        "batteryPercent" to state.batteryPercent,
        "idleMinutes" to state.idleMinutes,
        "startedAt" to startedAt,
        "lastTickAt" to lastTickAt,
        "lastLocationAt" to lastLocationAt,
        "locationIntervalMs" to locationIntervalMs(tier),
        "nextPollAt" to (if (lastTickAt == 0L) 0L else lastTickAt + nextWaitMs),
        "projectionActive" to projectionActive,
        "userPresents" to userPresentCount,
        "foreground" to (instance != null)
      )
    }

    fun serviceInstance(): PuppyGuardService? = instance

    private fun projectionIntent(intent: Intent): Intent? =
      if (Build.VERSION.SDK_INT >= 33) {
        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
      } else {
        @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA)
      }
  }
}
