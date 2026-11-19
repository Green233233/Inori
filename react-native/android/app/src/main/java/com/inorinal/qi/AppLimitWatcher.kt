package com.inorinal.qi

import android.app.KeyguardManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * 小狗端的「应用限制」执行器。
 *
 * 主人下发的名单持久化在 `qi.limits`，本对象只做一件事：在 [PuppyGuardService]
 * 的进程里轻量轮询前台应用，命中名单就通过 [BlockedOverlay] 盖上全屏提示。
 *
 * 设计取舍（改之前先读完）：
 *  - 跑在单线程 [ScheduledExecutorService] 上，而不是 Handler：queryEvents 是
 *    binder 调用，放在主线程会和 RN 的节流查询抢帧，宁可让一根空闲线程等。
 *  - 不新起前台服务、不拿 WakeLock、不用 AlarmManager：灭屏立刻停止轮询，
 *    解锁才恢复，避免任何「后台常驻偷电」的嫌疑。
 *  - 只有「限制开启 && 名单非空 && 亮屏 && 已解锁」时才排下一次 tick；其余
 *    情况下 pending 为 null，[isWatching] 也如实返回 false。
 *  - PackageManager 只在需要时查单个包，并按包名缓存应用名，绝不
 *    getInstalledPackages 全量枚举。
 *  - 本对象不读通知、坐标、剪贴板等任何内容，日志里只出现包名和应用名。
 */
object AppLimitWatcher {
    private const val TAG = "QiLimits"
    private const val PREFS = "qi.limits"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_BLOCKED = "blocked"
    private const val KEY_UPDATED_AT = "updated_at"

    /** 看最近 10 s 的 RESUMED 事件，足够覆盖一次冷启动。 */
    private const val FOREGROUND_WINDOW_MS = 10_000L
    private const val SAVER_INTERVAL_MS = 4_000L
    private const val DEFAULT_INTERVAL_MS = 1_500L

    /** 同一款应用 60 s 内最多留一条审计，避免刷屏。 */
    private const val AUDIT_INTERVAL_MS = 60_000L
    private const val LABEL_CACHE_LIMIT = 200

    data class BlockedApp(val pkg: String, val label: String)

    private data class Rules(val enabled: Boolean, val blocked: List<BlockedApp>)

    private val lock = Any()

    /** 包名 -> 应用名；只缓存真正查过的包，量级约等于名单大小。 */
    private val labelCache = HashMap<String, String>()

    private var executor: ScheduledExecutorService? = null
    private var pending: ScheduledFuture<*>? = null
    private var attached = false

    /** 由 [start] 写入、轮询线程读取；`@Volatile` 保证线程之间立刻可见。 */
    @Volatile
    private var appContext: Context? = null

    private var receiver: BroadcastReceiver? = null

    @Volatile
    private var rules = Rules(false, emptyList())

    private var lastAuditPkg: String? = null
    private var lastAuditAt = 0L

    // ------------------------------------------------------------ rules API

    /**
     * 写入一份新名单（来自主人端 relay，或主人端页面的本地保存）。
     *
     * 返回 true 表示已经落盘；格式非法或写入失败时返回 false，旧名单保持不变。
     * 服务在跑时立即重新排期，所以主人改完名单无需重启任何东西。
     */
    fun applyRules(context: Context, json: String): Boolean {
        val parsed = parseRules(json)
        if (parsed == null) {
            Log.w(TAG, "限制规则 JSON 非法，保留旧名单")
            return false
        }
        val app = context.applicationContext
        val stored =
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ENABLED, parsed.enabled)
                .putString(KEY_BLOCKED, encodeBlocked(parsed.blocked).toString())
                .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
                .commit()
        if (!stored) {
            Log.w(TAG, "写入限制规则失败")
            return false
        }
        synchronized(lock) {
            rules = parsed
            if (attached) {
                rescheduleLocked()
            }
        }
        return true
    }

    /** 当前落盘的名单，格式与 [applyRules] 的入参一致，供上报 / UI 回读。 */
    fun snapshot(context: Context): String {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val result =
            JSONObject()
                .put("enabled", prefs.getBoolean(KEY_ENABLED, false))
                .put("blocked", encodeBlocked(parseBlocked(prefs.getString(KEY_BLOCKED, null))))
                .put("updated_at", prefs.getLong(KEY_UPDATED_AT, 0L))
        return result.toString()
    }

    // ------------------------------------------------------------ lifecycle

    /** 幂等；由 [PuppyGuardService] 在成为前台服务后调用。 */
    fun start(context: Context) {
        val app = context.applicationContext
        synchronized(lock) {
            appContext = app
            if (attached) {
                rules = readRules(app)
                rescheduleLocked()
                return
            }
            attached = true
            rules = readRules(app)
            executor =
                Executors.newSingleThreadScheduledExecutor { runnable ->
                    Thread(runnable, "qi-app-limit").apply {
                        isDaemon = true
                        priority = Thread.MIN_PRIORITY
                    }
                }
            registerScreenReceiver(app)
            rescheduleLocked()
        }
    }

    /** 幂等；服务被销毁时调用，同时撤掉可能还挂着的拦截浮层。 */
    fun stop(@Suppress("UNUSED_PARAMETER") context: Context) {
        synchronized(lock) {
            attached = false
            pending?.cancel(false)
            pending = null
            unregisterScreenReceiver()
            executor?.shutdownNow()
            executor = null
            appContext = null
            rules = Rules(false, emptyList())
        }
        BlockedOverlay.hide()
    }

    /** 供 QiLimits.getStatus 展示：现在是否真的在轮询。 */
    fun isWatching(): Boolean =
        synchronized(lock) {
            attached && pending != null && rules.enabled && rules.blocked.isNotEmpty()
        }

    // ------------------------------------------------------------ scheduling

    /** 调用方必须持有 [lock]。 */
    private fun rescheduleLocked() {
        pending?.cancel(false)
        pending = null
        val context = appContext ?: return
        val exec = executor ?: return
        if (!attached || !rules.enabled || rules.blocked.isEmpty() || !deviceUsable(context)) {
            BlockedOverlay.hide()
            return
        }
        pending =
            exec.schedule(
                Runnable { runTick() },
                intervalMs(context),
                TimeUnit.MILLISECONDS,
            )
    }

    private fun runTick() {
        val context = appContext ?: return
        try {
            tick(context)
        } catch (error: Exception) {
            Log.w(TAG, "应用限制轮询失败", error)
        } finally {
            synchronized(lock) {
                if (attached) {
                    rescheduleLocked()
                }
            }
        }
    }

    private fun tick(context: Context) {
        if (!rules.enabled || rules.blocked.isEmpty() || !deviceUsable(context)) {
            BlockedOverlay.hide()
            return
        }
        val foreground = foregroundPackage(context) ?: return
        // 前台换过应用，「我知道了」的抑制就作废：再次进入（哪怕是另一款被禁应用）都要重新拦截。
        BlockedOverlay.clearDismissedIfLeft(foreground)
        if (foreground == context.packageName) {
            // 小狗正在祈里（比如权限管控中心），自己不该被自己挡住。
            BlockedOverlay.hide()
            return
        }
        val rule = rules.blocked.firstOrNull { it.pkg == foreground }
        if (rule == null) {
            BlockedOverlay.hide()
            return
        }
        if (BlockedOverlay.isDismissedFor(foreground)) {
            // 用户刚点过「我知道了」；停在这个应用里不重复弹，离开即失效。
            return
        }
        val label = rule.label.ifBlank { labelFor(context, foreground) }
        if (BlockedOverlay.show(context, foreground, label)) {
            audit(context, foreground, label)
        }
    }

    // ------------------------------------------------------------ detection

    /** 最近一条 ACTIVITY_RESUMED 的包名；没有使用权限时 queryEvents 返回空。 */
    private fun foregroundPackage(context: Context): String? {
        val manager =
            context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
        val now = System.currentTimeMillis()
        val events = manager.queryEvents(now - FOREGROUND_WINDOW_MS, now) ?: return null
        var foreground: String? = null
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                foreground = event.packageName
            }
        }
        return foreground
    }

    private fun intervalMs(context: Context): Long {
        val state = PuppyGuardService.lastState
        val requested = PuppyGuardService.tier
        val effective =
            if (state != null) {
                PowerGovernor.effectiveTier(state, requested)
            } else {
                val stored =
                    context
                        .getSharedPreferences(PuppyGuardService.PREFS, Context.MODE_PRIVATE)
                        .getString(PuppyGuardService.PREF_TIER, null)
                if (stored == null) {
                    requested
                } else {
                    runCatching { Tier.valueOf(stored.uppercase()) }.getOrDefault(requested)
                }
            }
        return if (effective == Tier.SAVER) SAVER_INTERVAL_MS else DEFAULT_INTERVAL_MS
    }

    private fun deviceUsable(context: Context): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        if (!power.isInteractive) return false
        val keyguard =
            context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager ?: return true
        return !keyguard.isKeyguardLocked
    }

    private fun labelFor(context: Context, pkg: String): String {
        synchronized(lock) {
            labelCache[pkg]?.let { return it }
        }
        val label =
            try {
                val info = context.packageManager.getApplicationInfo(pkg, 0)
                context.packageManager.getApplicationLabel(info).toString()
            } catch (error: PackageManager.NameNotFoundException) {
                pkg
            } catch (error: Exception) {
                Log.w(TAG, "读取应用名失败：$pkg", error)
                pkg
            }
        synchronized(lock) {
            if (labelCache.size >= LABEL_CACHE_LIMIT) {
                labelCache.clear()
            }
            labelCache[pkg] = label
        }
        return label
    }

    private fun audit(context: Context, pkg: String, label: String) {
        val now = SystemClock.elapsedRealtime()
        if (lastAuditPkg == pkg && now - lastAuditAt < AUDIT_INTERVAL_MS) {
            return
        }
        lastAuditPkg = pkg
        lastAuditAt = now
        AuditLogModule.write("app.limit.block", "$label 被拦截", context)
    }

    // ------------------------------------------------------------ receivers

    private fun registerScreenReceiver(context: Context) {
        if (receiver != null) return
        val listener =
            object : BroadcastReceiver() {
                override fun onReceive(receiverContext: Context, intent: Intent) {
                    synchronized(lock) {
                        if (attached) {
                            rescheduleLocked()
                        }
                    }
                }
            }
        val filter =
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_USER_PRESENT)
            }
        try {
            ContextCompat.registerReceiver(context, listener, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            receiver = listener
        } catch (error: Exception) {
            Log.w(TAG, "注册屏幕状态广播失败", error)
        }
    }

    private fun unregisterScreenReceiver() {
        val listener = receiver ?: return
        receiver = null
        runCatching { appContext?.unregisterReceiver(listener) }
    }

    // ------------------------------------------------------------ parsing

    private fun readRules(context: Context): Rules {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Rules(
            enabled = prefs.getBoolean(KEY_ENABLED, false),
            blocked = parseBlocked(prefs.getString(KEY_BLOCKED, null)),
        )
    }

    private fun parseRules(json: String): Rules? {
        return try {
            val obj = JSONObject(json)
            Rules(
                enabled = obj.optBoolean("enabled", false),
                blocked = readBlockedArray(obj.optJSONArray("blocked")),
            )
        } catch (error: JSONException) {
            Log.w(TAG, "限制规则 JSON 非法", error)
            null
        } catch (error: Exception) {
            Log.w(TAG, "解析限制规则失败", error)
            null
        }
    }

    private fun parseBlocked(raw: String?): List<BlockedApp> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            readBlockedArray(JSONArray(raw))
        } catch (error: JSONException) {
            Log.w(TAG, "已存的限制名单损坏，按空名单处理", error)
            emptyList()
        } catch (error: Exception) {
            Log.w(TAG, "读取限制名单失败", error)
            emptyList()
        }
    }

    private fun readBlockedArray(array: JSONArray?): List<BlockedApp> {
        if (array == null) return emptyList()
        val seen = HashSet<String>()
        val result = ArrayList<BlockedApp>(array.length())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val pkg = item.optString("pkg", "").trim()
            if (pkg.isBlank() || !seen.add(pkg)) continue
            val label = item.optString("label", "").trim().ifBlank { pkg }
            result.add(BlockedApp(pkg, label))
        }
        return result
    }

    private fun encodeBlocked(blocked: List<BlockedApp>): JSONArray {
        val array = JSONArray()
        for (entry in blocked) {
            array.put(JSONObject().put("pkg", entry.pkg).put("label", entry.label))
        }
        return array
    }
}
