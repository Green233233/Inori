package com.inorinal.qi

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent

/**
 * 保活用的「最小」无障碍服务。
 *
 * 唯一职责：当用户把「祈」切回前台时，顺手看一眼守护服务还在不在；不在就
 * [PuppyGuardService.start] 重新拉起。它**不做**任何事：
 *  - 不读屏幕内容（`res/xml/qi_accessibility.xml` 里 `canRetrieveWindowContent=false`
 *    写死，系统连无障碍树都不会给我们）；
 *  - 不读输入（没有 `canRequestFilterKeyEvents`，也没有 `flagRequestFilterKeyEvents`）；
 *  - 不注入手势、不点按、不监听其它应用的窗口内容；
 *  - 只收 `typeWindowStateChanged`，且只认自己包名的事件，别的事件直接丢。
 *
 * 为什么需要它：Android 10+ 上没有任何 API 能让一个已经被杀掉的进程自己醒来。
 * 前台服务负责「活着」，而无障碍服务是系统少数几个会主动重新绑定、并且能拿到
 * 进程拉起机会的组件——用户打开祈的瞬间，就是最自然、最省电的复活点。
 *
 * 用户可以随时在「设置 → 无障碍」里关掉，关掉后其它能力照常工作，只是少了这层
 * 兜底。这一点在权限管控中心里写明了。
 */
class QiAccessibilityService : AccessibilityService() {

  private var connectedAt: Long = 0L

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    connectedAt = System.currentTimeMillis()
    val context = applicationContext
    val prefs = prefs(context)
    prefs.edit()
      .putLong(PREF_CONNECTED_AT, connectedAt)
      .putBoolean(PREF_CONNECTED, true)
      .apply()
    AuditLog.append(context, "accessibility.connected", "onServiceConnected")
    // 开关刚打开时守护通常也没起，这里补一次。
    ensureGuardAlive(context, "connect")
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return
    if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    // 只认自己：别人的窗口切换与我们无关，也避免被当成监控。
    val pkg = event.packageName?.toString()
    if (pkg != packageName) return
    ensureGuardAlive(applicationContext, "foreground")
  }

  override fun onInterrupt() {
    // 没有任何要中断的工作：本服务不排队、不持锁、不发请求。
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    val context = applicationContext
    instance = null
    prefs(context).edit().putBoolean(PREF_CONNECTED, false).apply()
    AuditLog.append(context, "accessibility.unbound", "onUnbind")
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  private fun ensureGuardAlive(context: Context, reason: String) {
    if (PuppyGuardService.running) return
    // 同一秒内的多次窗口切换只处理一次，避免拉起风暴。
    val now = SystemClock.elapsedRealtime()
    val store = prefs(context)
    val last = store.getLong(PREF_LAST_REVIVE_ELAPSED, 0L)
    if (now - last < REVIVE_MIN_INTERVAL_MS) return
    store.edit().putLong(PREF_LAST_REVIVE_ELAPSED, now).apply()
    PuppyGuardService.start(context)
    AuditLog.append(context, "guard.revived", "accessibility:$reason")
  }

  companion object {
    /**
     * 系统只在用户启用后才会绑定我们，所以「当前有没有实例」比读 Settings
     * 更实时；只用它回答「保活是不是在位」。
     */
    @Volatile
    private var instance: QiAccessibilityService? = null

    const val PREFS = "qi.accessibility"
    const val PREF_CONNECTED = "connected"
    const val PREF_CONNECTED_AT = "connectedAt"
    const val PREF_LAST_REVIVE_ELAPSED = "lastReviveElapsed"

    /** 两次复活之间至少隔 10 秒，够用且不会在快速切应用时抖。 */
    private const val REVIVE_MIN_INTERVAL_MS = 10_000L

    private fun prefs(context: Context): SharedPreferences =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * 服务是否被系统真正绑定着。系统只在我们被启用时绑定，所以
     * `instance != null` 就是最准的信号，比读 Settings 更实时。
     */
    fun isRunning(): Boolean = instance != null

    /**
     * 回到桌面。应用限制的拦截卡被点掉后用它把用户从被禁应用里带出来，
     * 不然用户还停在那个应用的画面上，看不出「其实已经被关掉了」。
     * 无障碍没开就返回 false，调用方退化成只关遮罩。
     */
    fun goHome(): Boolean {
      val service = instance ?: return false
      return runCatching { service.performGlobalAction(GLOBAL_ACTION_HOME) }
        .getOrDefault(false)
    }

    /** 给权限中心 / 原生 status 用的只读快照。 */
    fun snapshot(context: Context): Map<String, Any?> {
      val store = prefs(context)
      return linkedMapOf(
        "running" to isRunning(),
        "connected" to store.getBoolean(PREF_CONNECTED, false),
        "connectedAt" to store.getLong(PREF_CONNECTED_AT, 0L),
        "guardRunning" to PuppyGuardService.running,
      )
    }
  }
}
