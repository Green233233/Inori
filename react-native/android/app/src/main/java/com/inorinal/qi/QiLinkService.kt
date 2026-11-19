package com.inorinal.qi

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.time.Instant
import java.time.temporal.ChronoUnit
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
 *  - 不解密消息：`ciphertext` 只在内存里跟着 JSON 走一趟就被丢弃；
 *  - 不碰 `command.send` 的确认：那条命令必须留给 JS 执行，服务只提醒。
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
        if (kind in NOTIFY_KINDS) {
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
        KIND_TASK_VERDICT -> "任务有结果了" to "主人看过你提交的内容$whenText"
        KIND_REWARD_GRANT -> "收到一张奖励券" to "打开「和好券」看看主人给了什么$whenText"
        KIND_COMMAND_SEND -> "主人发来一条指令" to "打开「祈」后就会执行$whenText"
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

    const val ACTION_START = "com.inorinal.qi.link.START"
    const val ACTION_STOP = "com.inorinal.qi.link.STOP"
    const val EXTRA_TOKEN = "token"
    const val EXTRA_BASE_URL = "baseUrl"

    private const val SECRETS_PREFS = "qi.secrets"
    private const val TOKEN_KEY = "account.token"
    private const val POLL_WAIT_SECONDS = 30
    private const val PAGE_LIMIT = 50
    private const val MAX_NOTIFICATIONS_PER_PAGE = 3

    private const val KIND_TASK_CREATE = "task.create"
    private const val KIND_TASK_VERDICT = "task.verdict"
    private const val KIND_REWARD_GRANT = "reward.grant"
    private const val KIND_COMMAND_SEND = "command.send"

    private val NOTIFY_KINDS =
      setOf(KIND_TASK_CREATE, KIND_TASK_VERDICT, KIND_REWARD_GRANT, KIND_COMMAND_SEND)

    /** 与 JS 侧 alerts.ts 用同一个 id，重复时是「更新」而不是「再来一条」。 */
    fun noticeId(seq: Long): String = "qi.link.$seq"

    @Volatile private var instance: QiLinkService? = null

    @Volatile var foreground: Boolean = false

    @Volatile var lastPollAt: Long = 0L

    @Volatile var lastError: String = ""

    /** 本轮是否还有积压（JS 只读展示用，不影响行为）。 */
    @Volatile var remainingBacklog: Boolean = false

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
      val cursor =
        context
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .getLong(PREF_CURSOR, 0L)
      return linkedMapOf(
        "running" to isRunning(),
        "foreground" to foreground,
        "cursor" to cursor,
        "lastPollAt" to lastPollAt,
        "lastError" to lastError,
        "backlog" to remainingBacklog,
      )
    }
  }
}

/** 非 2xx 只带状态码，不携带响应体（可能包含服务器内部信息）。 */
private class HttpStatusException(val status: Int) : Exception("relay_http_$status")
