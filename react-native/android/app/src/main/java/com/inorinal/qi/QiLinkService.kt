package com.inorinal.qi

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * 小狗端的常驻「联动」通道。
 *
 * 为什么需要它：主人派任务、发券时，小狗端原来的中继轮询只活在 JS 里，
 * App 在后台或被杀掉就完全收不到。FCM 在这个自托管部署里不可用，所以这里
 * 让一个前台服务自己轮询服务端中继，收到 `task.create` / `reward.grant` 等
 * 明文 kind 就发一条系统通知；正文仍是密文，服务不解析、不落盘。
 *
 * 明确不做的事：
 *  - 不打印 token / baseUrl / ciphertext：日志只有 kind、seq 和异常类名；
 *  - 不解析普通消息：`ciphertext` 只在内存里跟着 JSON 走一趟就被丢弃。
 *
 * 唯一的例外是这台设备自己就能回答的只读命令：`command.send` 里 kind 为
 * `location.get` / `usage.stats` / `permissions.snapshot` 时，服务自己解密、
 * 执行、回一条 `command.reply`，再 ack 那一条。原因是 App 被划掉后 JS 的
 * 轮询不在，主人不该为一个「对方没有响应」干等 40 秒。其余命令保持老样子：
 * 只提醒、不执行、不 ack。
 *
 * 生命周期：
 *  - `START_STICKY` + `stopWithTask=false`：进程被系统回收后由系统重建，
 *    重建时没有 Intent，token 从 `qi.secrets`（Keystore 加密）里重新取；
 *  - 只在 role=PUPPY 且已配对时由 JS 启动；解绑/退出登录由 JS 停止。
 */
class QiLinkService : Service() {

  private val running = AtomicBoolean(false)
  private var loopThread: Thread? = null
  private val loopLock = ReentrantLock()
  private val loopSignal = loopLock.newCondition()

  /**
   * 只读命令的执行线程。
   *
   * 单线程是刻意的：轮询线程只管收消息，命令（定位可能要 12 秒、逆地理 6
   * 秒）在这里串行跑，既不会阻塞长轮询，也不会几条命令一起把主线程/GPS
   * 抢爆。线程本身是 daemon，进程死了就跟着走。
   */
  private val commandExecutor: ExecutorService =
    Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "qi-link-command").apply {
        isDaemon = true
        priority = Thread.NORM_PRIORITY - 1
      }
    }

  /** 20 秒硬上限：超时就打断执行线程，让主人收到带 error 的回复。 */
  private val commandWatchdog: ScheduledExecutorService =
    Executors.newSingleThreadScheduledExecutor { runnable ->
      Thread(runnable, "qi-link-command-watchdog").apply { isDaemon = true }
    }

  /** 启动时由 JS 传入；只在内存里，随进程消失。 */
  @Volatile private var pendingToken: String? = null

  /** 启动时由 JS 传入的服务器地址；为空则回落到 `qi.net` 的配置。 */
  @Volatile private var pendingBaseUrl: String? = null

  private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
  private val netPrefs by lazy { getSharedPreferences("qi.net", Context.MODE_PRIVATE) }
  private val secretPrefs by lazy {
    getSharedPreferences(SECRETS_PREFS, Context.MODE_PRIVATE)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      shutdown()
      stopSelf()
      return START_NOT_STICKY
    }
    intent?.getStringExtra(EXTRA_TOKEN)?.let { if (it.isNotEmpty()) pendingToken = it }
    intent?.getStringExtra(EXTRA_BASE_URL)?.let { if (it.isNotEmpty()) pendingBaseUrl = it }

    // 先把自己升成前台：一是后面一轮长轮询可能阻塞几十秒，二是
    // startForegroundService 之后必须在 5 秒内 startForeground，否则会被
    // 系统判为 ANR —— 所以这个调用要放在任何提前返回之前。
    ensureForeground()

    // 双保险：即使 JS 侧判断错了，也绝不替主人端跑这个通道。
    if (!isPuppySide()) {
      shutdown()
      stopSelf()
      return START_NOT_STICKY
    }
    startLoop()
    running.set(true)
    return START_STICKY
  }

  override fun onDestroy() {
    shutdown()
    foreground = false
    instance = null
    super.onDestroy()
  }

  /** 从最近任务里划掉 App 之后，通道仍然在。 */
  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
  }

  // ------------------------------------------------------------- lifecycle

  private fun startLoop() {
    if (loopThread?.isAlive == true) return
    running.set(true)
    loopThread =
      Thread({ relayLoop() }, "qi-link-loop").apply {
        // 几乎全程在等网络，永远不该和 UI 抢 CPU。
        priority = Thread.MIN_PRIORITY
        isDaemon = true
        start()
      }
  }

  private fun shutdown() {
    running.set(false)
    wake()
    loopThread?.let { thread -> runCatching { thread.join(1_000) } }
    loopThread = null
    // 服务停了就不该再执行新命令；已经在跑的等它自己超时（20 秒上限）。
    commandExecutor.shutdown()
    commandWatchdog.shutdownNow()
  }

  private fun wake() {
    loopLock.lock()
    try {
      loopSignal.signalAll()
    } finally {
      loopLock.unlock()
    }
  }

  private fun nap(millis: Long) {
    loopLock.lock()
    try {
      loopSignal.await(millis, TimeUnit.MILLISECONDS)
    } catch (interrupted: InterruptedException) {
      Thread.currentThread().interrupt()
    } finally {
      loopLock.unlock()
    }
  }

  // ----------------------------------------------------------------- loop

  /**
   * 一次循环 = 一次长轮询。成功时服务端本身已经等过 [POLL_WAIT_SECONDS]，
   * 所以不再额外 sleep；失败按 5s → 30s → 60s 退避。
   */
  private fun relayLoop() {
    var failures = 0
    while (running.get()) {
      if (failures > 0) {
        nap(backoffMs(failures))
        if (!running.get()) break
      }
      val token = resolveToken()
      if (token.isNullOrEmpty()) {
        // 可能刚被退出登录；继续等，JS 下次启动会重新带 token 进来。
        failures += 1
        continue
      }
      try {
        val page = request(
          "GET",
          "/api/v1/relay/poll?cursor=${cursor()}&wait=$POLL_WAIT_SECONDS",
          null,
          token,
          POLL_WAIT_SECONDS * 1000L + 20_000L
        )
        failures = 0
        lastPollAt = SystemClock.elapsedRealtime()
        lastError = ""
        handlePage(page, token)
      } catch (auth: HttpStatusException) {
        // 401/403 说明 token 已失效（退出登录/换账号）：停下来，不要拿作废
        // 凭据无限重试。
        if (auth.status == 401 || auth.status == 403) {
          lastError = "unauthorized"
          shutdown()
          stopSelf()
          return
        }
        failures += 1
        lastError = "http_${auth.status}"
      } catch (error: Exception) {
        failures += 1
        // 只记类名：不能把 URL / token / 响应体写进日志。
        lastError = error.javaClass.simpleName
      }
    }
  }

  private fun backoffMs(failures: Int): Long =
    when {
      failures <= 1 -> 5_000L
      failures == 2 -> 30_000L
      else -> 60_000L
    }

  private fun handlePage(page: JSONObject, token: String) {
    val items = page.optJSONArray("items")
    val ackSeqs = ArrayList<Long>(items?.length() ?: 0)
    var notified = 0
    if (items != null) {
      for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        val seq = item.optLong("seq", 0L)
        val kind = item.optString("kind", "")
        if (seq <= 0L) continue
        val time = item.optString("createdAt", "")
        // 应用限制是「状态同步」而不是「命令」：小狗端可能根本不在前台，
        // JS 的 relay 循环那时是停的，所以必须由常驻服务自己落盘。
        if (kind == KIND_APP_LIMIT) {
          if (applyAppLimit(item, token)) continue
        }
        if (kind in NOTIFY_KINDS) {
          // 自己能回答的只读命令：交给执行线程，回包成功后由它 ack 这一条。
          // 不在这里 ack：万一回包没发出去，下一条轮询还应该能重试。
          if (kind == KIND_COMMAND_SEND && dispatchCommand(item, token)) continue
          // 一次最多三条：刚从后台回来时别把积压的消息一次性刷屏。
          val fresh = !firstRun() || isRecent(time)
          if (fresh && notified < MAX_NOTIFICATIONS_PER_PAGE && canPostNotification()) {
            notifyFor(kind, seq, item.optString("createdAtDisplay", ""))
            notified += 1
          }
          // command.send 必须留给 JS 执行，只提醒、不确认。
          if (kind != KIND_COMMAND_SEND) ackSeqs.add(seq)
        }
      }
    }
    if (ackSeqs.isNotEmpty()) runCatching { acknowledge(ackSeqs, token) }
    val next = page.optLong("cursor", 0L)
    if (next > 0L) prefs.edit().putLong(PREF_CURSOR, next).apply()
    remainingBacklog = (items?.length() ?: 0) >= PAGE_LIMIT
  }

  // -------------------------------------------------------------- commands

  /**
   * 原生落盘一条 `app.limit`（主人下发的应用限制），返回是否接管。
   *
   * 不走 `command.reply`：这不是一次问答，只是把名单同步过来。落盘成功就
   * ack，让主人端看到「已送达」；失败则留着重试，JS 兜底也还能处理。
   * 必须在这里做而不是交给 JS，因为小狗端 app 大概率在后台（那时 JS 的
   * relay 循环是停的），而限制恰恰要在「小狗没看祈」的时候生效。
   */
  private fun applyAppLimit(item: JSONObject, token: String): Boolean {
    val seq = item.optLong("seq", 0L)
    val ciphertext = item.optString("ciphertext", "")
    if (seq <= 0L || ciphertext.isEmpty()) return false
    val pair = pairContext() ?: return false
    return try {
      val payload = JSONObject(PairRelayCrypto.open(this, pair.first, pair.second, ciphertext))
      val rules =
        JSONObject()
          .put("enabled", payload.optBoolean("enabled", false))
          .put("blocked", payload.optJSONArray("blocked") ?: JSONArray())
      if (!AppLimitWatcher.applyRules(this, rules.toString())) {
        // 解析失败时保留旧名单，条目留给下一轮重试。
        lastCommandError = "bad_limit_rules"
        return false
      }
      // 服务可能在限制开启前就起来了，这里补一次 start（幂等）。
      AppLimitWatcher.start(this)
      acknowledge(listOf(seq), token)
      lastCommandAt = System.currentTimeMillis()
      lastCommandError = ""
      true
    } catch (error: Exception) {
      lastCommandError = error.javaClass.simpleName
      Log.w(TAG, "app_limit_failed ${error.javaClass.simpleName}")
      false
    }
  }

  /**
   * 尝试在原生侧执行一条 `command.send`，返回是否接管。
   *
   * 只有 [NATIVE_COMMAND_KINDS] 这三个只读命令会被接管；解不开、缺配对上下文
   * 或者不是只读命令都返回 false，条目原样留给 JS 轮询（JS 会自己解一次）。
   * 解密在轮询线程上同步做：ECDH 结果有缓存，AES-GCM 只解一个几百字节的
   * JSON，代价是微秒级；这样上层能直接决定「要不要通知」。
   */
  private fun dispatchCommand(item: JSONObject, token: String): Boolean {
    val seq = item.optLong("seq", 0L)
    val ciphertext = item.optString("ciphertext", "")
    if (seq <= 0L || ciphertext.isEmpty()) return false
    val pair = pairContext() ?: return false
    val request =
      try {
        JSONObject(PairRelayCrypto.open(this, pair.first, pair.second, ciphertext))
      } catch (error: Exception) {
        // 换过密钥、或不是发给我们的：留给 JS，它解不开也会安静丢掉。
        Log.w(TAG, "command_open_failed ${error.javaClass.simpleName}")
        return false
      }
    val id = request.optString("id", "")
    val kind = request.optString("kind", "")
    if (id.isEmpty() || kind !in NATIVE_COMMAND_KINDS) return false
    if (!running.get()) return false
    try {
      commandExecutor.execute { runNativeCommand(pair, seq, id, kind, request, token) }
    } catch (error: Exception) {
      Log.w(TAG, "command_dispatch_failed ${error.javaClass.simpleName}")
      return false
    }
    return true
  }

  /** 执行线程入口：读命令 → 本地执行 → 封 `command.reply` → 回发 → ack。 */
  private fun runNativeCommand(
    pair: Pair<String, String>,
    seq: Long,
    id: String,
    kind: String,
    request: JSONObject,
    token: String
  ) {
    val self = Thread.currentThread()
    val watchdog =
      runCatching {
        commandWatchdog.schedule(
          {
            lastCommandError = "timeout"
            self.interrupt()
          },
          COMMAND_TIMEOUT_MS,
          TimeUnit.MILLISECONDS
        )
      }.getOrNull()
    try {
      val reply = JSONObject().put("id", id)
      try {
        val data = executeReadOnlyCommand(kind, request)
        reply.put("ok", true).put("data", data)
        AuditLogModule.write("command.$kind", "主人下令 · 已执行", this)
        if (kind == KIND_LOCATION_GET) notifyLocationViewed(data)
      } catch (error: Exception) {
        lastCommandError = error.javaClass.simpleName
        // 只记 kind 与异常类名：命令参数与坐标不进日志。
        Log.w(TAG, "command_failed kind=$kind ${error.javaClass.simpleName}")
        reply.put("ok", false).put("error", commandErrorMessage(kind, error))
        AuditLogModule.write("command.$kind", "主人下令 · 失败（${error.javaClass.simpleName}）", this)
      }
      reply.put("at", System.currentTimeMillis())
      val envelope = PairRelayCrypto.seal(this, pair.first, pair.second, reply.toString())
      val body =
        JSONObject()
          .put("kind", KIND_COMMAND_REPLY)
          .put("ciphertext", envelope)
          .toString()
      request("POST", "/api/v1/relay/send", body, token, 15_000L)
      // 回包真的发出去了才 ack：否则宁可下一条轮询再执行一次，也不能让主人
      // 拿着一个永远到不了的 40 秒超时。
      acknowledge(listOf(seq), token)
      lastCommandAt = System.currentTimeMillis()
      lastCommandError = ""
    } catch (error: Exception) {
      lastCommandError = error.javaClass.simpleName
      Log.w(TAG, "command_reply_failed ${error.javaClass.simpleName}")
    } finally {
      watchdog?.cancel(false)
      // 看门狗可能是靠 interrupt 结束等待的，把中断位清掉，线程要能被复用。
      Thread.interrupted()
    }
  }

  private fun executeReadOnlyCommand(kind: String, request: JSONObject): Any =
    when (kind) {
      KIND_LOCATION_GET -> {
        if (!QiLocationEngine.hasPermission(this)) {
          throw IllegalStateException("缺少定位权限")
        }
        QiLocationEngine.describeJson(this, QiLocationEngine.locateNow(this))
      }
      KIND_USAGE_STATS -> {
        if (!QiUsageAggregator.hasUsageAccess(this)) {
          throw IllegalStateException("没有「使用情况访问」权限")
        }
        writableToJson(QiUsageAggregator.aggregate(this))
      }
      KIND_PERMISSIONS_SNAPSHOT -> permissionSnapshotJson()
      KIND_GUARD_LOCK -> lockDeviceNow()
      KIND_OVERLAY_SHOW -> showFullscreenMessage(request)
      KIND_NOTIFICATIONS_DRAIN -> drainNotifications(request.optJSONObject("args")?.optInt("limit", 50) ?: 50)
      else -> throw IllegalArgumentException("未知命令：$kind")
    }

  /**
   * 通知转发：把监听服务写下的队列交给主人，读完就清空。
   *
   * 和 JS 侧 `qiDevice.notifications.drain(limit)` 同一个语义，只是不需要小狗
   * 先把祈打开——通知积压往往就是他没打开的时候攒下的。
   */
  private fun drainNotifications(limit: Int): JSONArray {
    val file = NotificationRelayService.queueFile(this)
    if (!file.exists()) return JSONArray()
    val lines = runCatching { file.readLines() }.getOrDefault(emptyList())
    if (lines.isEmpty()) return JSONArray()
    val take = limit.coerceIn(1, MAX_DRAIN_LIMIT)
    val picked = lines.takeLast(take)
    val kept = if (lines.size > take) lines.dropLast(take) else emptyList()
    runCatching {
      if (kept.isEmpty()) file.delete() else file.writeText(kept.joinToString("\n", postfix = "\n"))
    }
    val array = JSONArray()
    for (line in picked) {
      runCatching { array.put(JSONObject(line)) }
    }
    return array
  }

  /**
   * 全屏消息：主人的一句话直接盖在小狗屏幕上，不需要他先打开祈。
   *
   * 没有悬浮窗权限时明确报错，让主人知道是权限问题而不是「小狗没理我」。
   */
  private fun showFullscreenMessage(request: JSONObject): Any {
    val args = request.optJSONObject("args") ?: JSONObject()
    val message = args.optString("message", "").trim()
    if (message.isEmpty()) throw IllegalArgumentException("消息不能为空")
    val timeout = args.optInt("timeoutMs", QiFullscreenMessage.DEFAULT_DURATION_MS)
    if (!QiFullscreenMessage.show(this, message, timeout)) {
      throw IllegalStateException("小狗还没有开启悬浮窗权限")
    }
    return JSONObject().put("shownAt", System.currentTimeMillis())
  }

  /**
   * 远程锁屏。设备管理器只持有 force-lock，所以这里能做的就只是把屏幕锁上；
   * 没授权时明确报错，让主人知道要先让小狗开设备管理器。
   */
  private fun lockDeviceNow(): Any {
    val manager = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!manager.isAdminActive(QiDeviceAdminReceiver.component(this))) {
      throw IllegalStateException("小狗还没有开启设备管理员")
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      @Suppress("DEPRECATION")
      manager.lockNow()
    } else {
      manager.lockNow()
    }
    AuditLogModule.write("admin.remoteLock", "主人远程锁定屏幕", this)
    return JSONObject().put("lockedAt", System.currentTimeMillis())
  }

  /** 与 `QiDevicePermissions.getSnapshot` 同形：[{key, granted}]。 */
  private fun permissionSnapshotJson(): JSONArray {
    val array = JSONArray()
    PermissionCenterModule.snapshot(this).forEach { (key, granted) ->
      array.put(JSONObject().put("key", key).put("granted", granted))
    }
    return array
  }

  /**
   * 位置被读取就地留痕：文案与 JS 的 `commands.ts` → `notifyLocationViewed`
   * 完全一致，重复到达时按 id 更新同一条。
   */
  private fun notifyLocationViewed(data: Any?) {
    val place = data as? JSONObject ?: return
    if (!place.optBoolean("ok", false)) return
    if (!place.has("lat") || !place.has("lng")) return
    // Android 13 及以下：主人取一次位置只留审计，不打扰小狗。
    if (Build.VERSION.SDK_INT < 34) return
    if (!canPostNotification()) return
    runCatching {
      NoticeCenter.post(
        this,
        NOTICE_LOCATION_VIEWED,
        "主人想看看你在哪儿",
        "Android 14 起需要你自己点一下确认：打开「祈」→ 权限管控中心 → 定位",
        false
      )
    }.onFailure { Log.w(TAG, "notice_failed ${it.javaClass.simpleName}") }
  }

  /** 给主人看的一句话错误；带上「怎么修」，而不是只回异常类名。 */
  private fun commandErrorMessage(kind: String, error: Exception): String =
    when {
      error is InterruptedException -> "执行超时，稍后再试"
      error is IllegalStateException && kind == KIND_LOCATION_GET ->
        "缺少定位权限，请在系统设置里给「祈」开启定位"
      error is IllegalStateException && kind == KIND_USAGE_STATS ->
        "小狗端没有「使用情况访问」权限"
      else -> error.message ?: "执行失败"
    }

  private fun writableToJson(map: ReadableMap): JSONObject {
    val json = JSONObject()
    val keys = map.keySetIterator()
    while (keys.hasNextKey()) {
      val key = keys.nextKey()
      when (map.getType(key)) {
        ReadableType.Null -> json.put(key, JSONObject.NULL)
        ReadableType.Boolean -> json.put(key, map.getBoolean(key))
        ReadableType.Number -> json.put(key, map.getDouble(key))
        ReadableType.String -> json.put(key, map.getString(key) ?: "")
        ReadableType.Map -> json.put(key, writableToJson(map.getMap(key) ?: continue))
        ReadableType.Array -> json.put(key, writableToArray(map.getArray(key) ?: continue))
        else -> json.put(key, JSONObject.NULL)
      }
    }
    return json
  }

  private fun writableToArray(array: ReadableArray): JSONArray {
    val json = JSONArray()
    for (index in 0 until array.size()) {
      when (array.getType(index)) {
        ReadableType.Null -> json.put(JSONObject.NULL)
        ReadableType.Boolean -> json.put(array.getBoolean(index))
        ReadableType.Number -> json.put(array.getDouble(index))
        ReadableType.String -> json.put(array.getString(index) ?: "")
        ReadableType.Map -> json.put(writableToJson(array.getMap(index) ?: continue))
        ReadableType.Array -> json.put(writableToArray(array.getArray(index) ?: continue))
        else -> json.put(JSONObject.NULL)
      }
    }
    return json
  }

  /** 原生执行命令需要的配对上下文；缺任一项就不接手，留给 JS。 */
  private fun pairContext(): Pair<String, String>? {
    val pairId = prefs.getString(PREF_PAIR_ID, "")?.trim().orEmpty()
    val peerPublicB64 = prefs.getString(PREF_PEER_PUB, "")?.trim().orEmpty()
    if (pairId.isEmpty() || peerPublicB64.isEmpty()) return null
    return pairId to peerPublicB64
  }

  /** 首次启动（没有游标）时只提醒最近发生的事，历史积压只确认不打扰。 */
  private fun firstRun(): Boolean = !prefs.contains(PREF_CURSOR)

  private fun isRecent(createdAt: String): Boolean {
    if (createdAt.isBlank()) return false
    return runCatching {
      val moment = Instant.parse(createdAt)
      moment.isAfter(Instant.now().minus(10, ChronoUnit.MINUTES))
    }.getOrDefault(false)
  }

  private fun cursor(): Long = prefs.getLong(PREF_CURSOR, 0L)

  // ------------------------------------------------------------ transport

  private fun request(
    method: String,
    path: String,
    body: String?,
    token: String,
    timeoutMs: Long
  ): JSONObject {
    val base = resolveBaseUrl().trimEnd('/')
    if (base.isEmpty()) throw IllegalStateException("relay_not_configured")
    val connection = URL(base + path).openConnection() as HttpURLConnection
    try {
      val pin = netPrefs.getString("pin", "") ?: ""
      if (connection is HttpsURLConnection && pin.isNotEmpty()) {
        connection.sslSocketFactory = pinnedSocketFactory(pin)
        // 自签名证书常常没有匹配的 SAN，peer 身份由指纹保证。
        connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
      }
      connection.requestMethod = method
      connection.connectTimeout = 10_000
      connection.readTimeout = timeoutMs.coerceIn(1_000L, 120_000L).toInt()
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      connection.setRequestProperty("Authorization", "Bearer $token")
      if (body != null) {
        val payload = body.toByteArray(Charsets.UTF_8)
        connection.doOutput = true
        connection.setFixedLengthStreamingMode(payload.size)
        connection.outputStream.use { it.write(payload) }
      }
      val status = connection.responseCode
      if (status !in 200..299) {
        // 不读错误正文：里面可能带服务器内部信息，状态码已足够决定退避。
        throw HttpStatusException(status)
      }
      val text = connection.inputStream.use { readAll(it) }
      return JSONObject(text)
    } finally {
      connection.disconnect()
    }
  }

  private fun acknowledge(seqs: List<Long>, token: String) {
    val payload = JSONObject().put("seqs", JSONArray(seqs)).toString()
    request("POST", "/api/v1/relay/ack", payload, token, 15_000L)
  }

  private fun readAll(stream: java.io.InputStream): String {
    val buffer = ByteArrayOutputStream()
    val chunk = ByteArray(8192)
    while (true) {
      val read = stream.read(chunk)
      if (read <= 0) break
      buffer.write(chunk, 0, read)
    }
    return String(buffer.toByteArray(), Charsets.UTF_8)
  }

  /** 与 ApiClientModule 相同的证书指纹校验；只在已 pin 的服务器上跑。 */
  private fun pinnedSocketFactory(pin: String): javax.net.ssl.SSLSocketFactory {
    val trustManager =
      object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
          throw CertificateException("不支持客户端证书校验")
        }

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
          if (chain.isEmpty()) throw CertificateException("服务器证书链为空")
          val digest = MessageDigest.getInstance("SHA-256").digest(chain[0].encoded)
          val actual = digest.joinToString("") { "%02x".format(it) }
          if (actual != pin) throw CertificateException("服务器证书指纹不匹配")
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
      }
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(trustManager), null)
    return context.socketFactory
  }

  private fun resolveBaseUrl(): String {
    pendingBaseUrl?.let { if (it.isNotBlank()) return it }
    return netPrefs.getString("baseUrl", "") ?: ""
  }

  /**
   * 令牌只在内存和 Keystore 里：JS 传进来时用内存副本；若服务是被系统
   * 重建的（没有 Intent），就从 `qi.secrets` 里解封（KeystoreBox.open）。
   */
  private fun resolveToken(): String? {
    pendingToken?.let { if (it.isNotEmpty()) return it }
    val sealed = secretPrefs.getString(TOKEN_KEY, null) ?: return null
    return runCatching { String(KeystoreBox.open(sealed), Charsets.UTF_8) }.getOrNull()
  }

  // --------------------------------------------------------- notifications

  private fun ensureChannel() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel =
      NotificationChannel(CHANNEL_ID, "祈 · 联动", NotificationManager.IMPORTANCE_LOW).apply {
        description = "常驻的联动通道：有新任务或券时会单独提醒你"
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
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("祈 · 联动中")
      .setContentText("有新任务/券时提醒你")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(pending)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  /** 34 才认识 specialUse 这个位，低版本传 0（同 PuppyGuardService）。 */
  private fun baselineType(): Int =
    if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0

  private fun ensureForeground() {
    val notification = buildNotification()
    val type = baselineType()
    if (type == 0) {
      startForeground(NOTIFICATION_ID, notification)
    } else {
      startForeground(NOTIFICATION_ID, notification, type)
    }
    foreground = true
  }

  private fun canPostNotification(): Boolean =
    Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

  /**
   * 内容通知走既有的 "qi.notice" 渠道（IMPORTANCE_HIGH），用户可以在系统里
   * 单独关掉「祈 · 消息」；前台服务本身的低打扰通知留在 "qi.link"。
   * id 用 seq：同一条消息重复到达只会更新，不会堆成一列。
   */
  private fun notifyFor(kind: String, seq: Long, createdAtDisplay: String) {
    val whenText = if (createdAtDisplay.isBlank()) "" else " · $createdAtDisplay"
    val (title, body) =
      when (kind) {
        KIND_TASK_CREATE -> "主人给你派了新任务" to "打开「祈」看看今天要做什么$whenText"
        KIND_REWARD_GRANT -> "收到一张奖励券" to "打开「和好券」看看主人给了什么$whenText"
        // 任务、指令、查看屏幕时长等一律静默执行，只写审计；通知只留给
        // 「券 / 截屏 / Android 14+ 定位」这三类用户明确要求提醒的事。
        else -> return
      }
    runCatching { NoticeCenter.post(this, noticeId(seq), title, body, false) }
  }

  private fun isPuppySide(): Boolean {
    val file = File(filesDir, "qi/state.json")
    if (!file.exists()) return false
    val text = runCatching { file.readText(Charsets.UTF_8) }.getOrNull() ?: return false
    val pair = runCatching { JSONObject(text).optJSONObject("pair") }.getOrNull() ?: return false
    return pair.optString("myRole") == "PUPPY"
  }

  // ------------------------------------------------------------- companion

  companion object {
    const val CHANNEL_ID = "qi.link"
    const val NOTIFICATION_ID = 0x7102
    const val PREFS = "qi.link"
    const val PREF_CURSOR = "cursor"

    /** 配对上下文：由 JS 在配对成功后写进来，原生执行只读命令时要用。 */
    const val PREF_PAIR_ID = "pair_id"
    const val PREF_PEER_PUB = "peer_pub"

    const val ACTION_START = "com.inorinal.qi.link.START"
    const val ACTION_STOP = "com.inorinal.qi.link.STOP"
    const val EXTRA_TOKEN = "token"
    const val EXTRA_BASE_URL = "baseUrl"

    private const val TAG = "QiLink"
    private const val SECRETS_PREFS = "qi.secrets"
    private const val TOKEN_KEY = "account.token"
    private const val POLL_WAIT_SECONDS = 30
    private const val PAGE_LIMIT = 50
    private const val MAX_NOTIFICATIONS_PER_PAGE = 3

    /** location.get 冷启动可能花掉定位引擎的 12 秒，20 秒是它的上限加余量。 */
    private const val COMMAND_TIMEOUT_MS = 20_000L

    private const val KIND_TASK_CREATE = "task.create"
    private const val KIND_TASK_VERDICT = "task.verdict"
    private const val KIND_REWARD_GRANT = "reward.grant"
    private const val KIND_COMMAND_SEND = "command.send"
    private const val KIND_COMMAND_REPLY = "command.reply"

    private const val KIND_LOCATION_GET = "location.get"
    private const val KIND_USAGE_STATS = "usage.stats"
    private const val KIND_PERMISSIONS_SNAPSHOT = "permissions.snapshot"
    private const val KIND_APP_LIMIT = "app.limit"
    private const val KIND_GUARD_LOCK = "guard.lock"
    private const val KIND_OVERLAY_SHOW = "overlay.show"
    private const val KIND_NOTIFICATIONS_DRAIN = "notifications.drain"

    /** 一次最多交回 200 条，避免主人端表格被刷爆。 */
    private const val MAX_DRAIN_LIMIT = 200

    /**
     * 这些命令必须由常驻服务自己执行：小狗端很可能没打开祈，JS 的 relay 循环
     * 那时是停的，等 JS 执行等于「主人点了没反应」。
     */
    private val NATIVE_COMMAND_KINDS =
      setOf(
        KIND_LOCATION_GET,
        KIND_USAGE_STATS,
        KIND_PERMISSIONS_SNAPSHOT,
        KIND_GUARD_LOCK,
        KIND_OVERLAY_SHOW,
        KIND_NOTIFICATIONS_DRAIN
      )

    /** 与 JS 侧 `notifyLocationViewed` 用同一个 id，重复时是「更新」。 */
    private const val NOTICE_LOCATION_VIEWED = "qi.location.viewed"

    private val NOTIFY_KINDS =
      setOf(KIND_TASK_CREATE, KIND_TASK_VERDICT, KIND_REWARD_GRANT, KIND_COMMAND_SEND)

    /**
     * 写入配对上下文（只写 prefs，服务每轮轮询前自己读，不需要 IPC）。
     *
     * 两个值都不是秘密：pairId 是配对编号，公钥本来就是公开的；真正的设备
     * 私钥仍然只在 Keystore 里，解密时现取。
     */
    fun setPairContext(context: Context, pairId: String, peerPublicB64: String) {
      context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_PAIR_ID, pairId)
        .putString(PREF_PEER_PUB, peerPublicB64)
        .apply()
    }

    /** 与 JS 侧 alerts.ts 用同一个 id，重复时是「更新」而不是「再来一条」。 */
    fun noticeId(seq: Long): String = "qi.link.$seq"

    @Volatile private var instance: QiLinkService? = null

    @Volatile var foreground: Boolean = false

    @Volatile var lastPollAt: Long = 0L

    @Volatile var lastError: String = ""

    /** 本轮是否还有积压（JS 只读展示用，不影响行为）。 */
    @Volatile var remainingBacklog: Boolean = false

    /** 最近一次原生命令执行的时间 / 失败类名：只进 status，不含参数与坐标。 */
    @Volatile private var lastCommandAt: Long = 0L
    @Volatile private var lastCommandError: String = ""

    fun isRunning(): Boolean = instance != null

    fun start(context: Context, token: String, baseUrl: String) {
      val intent =
        Intent(context, QiLinkService::class.java)
          .setAction(ACTION_START)
          .putExtra(EXTRA_TOKEN, token)
          .putExtra(EXTRA_BASE_URL, baseUrl)
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      val intent = Intent(context, QiLinkService::class.java).setAction(ACTION_STOP)
      val delivered = runCatching { context.startService(intent) }.isSuccess
      if (!delivered) {
        runCatching { context.stopService(Intent(context, QiLinkService::class.java)) }
      }
    }

    fun snapshot(context: Context): Map<String, Any?> {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val cursor = prefs.getLong(PREF_CURSOR, 0L)
      val pairId = prefs.getString(PREF_PAIR_ID, "")?.trim().orEmpty()
      val peerPublicB64 = prefs.getString(PREF_PEER_PUB, "")?.trim().orEmpty()
      return linkedMapOf(
        "running" to isRunning(),
        "foreground" to foreground,
        "cursor" to cursor,
        "lastPollAt" to lastPollAt,
        "lastError" to lastError,
        "backlog" to remainingBacklog,
        // JS 只有看到 true 才敢把只读命令让给原生：否则没人执行。
        "pairReady" to (pairId.isNotEmpty() && peerPublicB64.isNotEmpty()),
        "lastCommandAt" to lastCommandAt,
        "lastCommandError" to lastCommandError,
      )
    }
  }
}

/** 非 2xx 只带状态码，不携带响应体（可能包含服务器内部信息）。 */
private class HttpStatusException(val status: Int) : Exception("relay_http_$status")
