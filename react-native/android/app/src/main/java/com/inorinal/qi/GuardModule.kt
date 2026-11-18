package com.inorinal.qi

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * JS control surface for [PuppyGuardService].
 *
 * Division of labour: the service decides *when*, JS performs the long poll
 * (it already owns the sealed transport and the pairing state). The service
 * therefore never touches the network and every method here returns immediately
 * — the only slow thing in the whole guard is the poll itself, and that runs on
 * the JS/native HTTP thread, never on this one.
 */
class GuardModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val prefs by lazy {
    reactApplicationContext.getSharedPreferences(PuppyGuardService.PREFS, Context.MODE_PRIVATE)
  }

  @Volatile private var failures = 0

  override fun getName(): String = "QiGuard"

  override fun initialize() {
    super.initialize()
    // Bridge the loop's tick into a device event. The service keeps running if
    // JS is detached; the lambda simply becomes a no-op then.
    PuppyGuardService.tickListener = { payload -> emitTick(payload) }
  }

  override fun invalidate() {
    if (PuppyGuardService.tickListener != null) {
      PuppyGuardService.tickListener = null
    }
    super.invalidate()
  }

  @ReactMethod
  fun start(promise: Promise) {
    try {
      PuppyGuardService.start(reactApplicationContext)
      AuditLogModule.write("guard.start", "前台守护已启动", reactApplicationContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("guard_start_failed", error.message, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      PuppyGuardService.stop(reactApplicationContext)
      AuditLogModule.write("guard.stop", "前台守护已停止", reactApplicationContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("guard_stop_failed", error.message, error)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      val map = Arguments.createMap()
      PuppyGuardService.snapshot(reactApplicationContext).forEach { (key, value) ->
        put(map, key, value)
      }
      map.putString(
        "requestedTier",
        prefs.getString(PuppyGuardService.PREF_TIER, Tier.BALANCED.name)?.lowercase()
          ?: Tier.BALANCED.name.lowercase()
      )
      map.putInt("failures", failures)
      // Monotonic, not wall-clock: useful for "how long ago was the last event"
      // and immune to the user changing the device time.
      map.putDouble("lastEventElapsed", PuppyGuardService.lastEventAt.toDouble())
      promise.resolve(map)
    } catch (error: Exception) {
      promise.reject("guard_status_failed", error.message, error)
    }
  }

  /**
   * Tier chosen by the user. PowerGovernor still overrides it to SAVER on low
   * battery — that is a deliberate safety rail, not a bug.
   */
  @ReactMethod
  fun setTier(tier: String, promise: Promise) {
    val parsed =
      runCatching { Tier.valueOf(tier.uppercase()) }.getOrElse {
        promise.reject("invalid_tier", "未知档位：$tier")
        return
      }
    prefs.edit().putString(PuppyGuardService.PREF_TIER, parsed.name).apply()
    promise.resolve(parsed.name.lowercase())
  }

  /** Called after a poll that produced something worth reacting to. */
  @ReactMethod
  fun notifyActivity(promise: Promise) {
    PuppyGuardService.notifyActivity()
    promise.resolve(true)
  }

  /**
   * Result of a long poll. Success resets the idle clock (the loop may then go
   * back to the fast cadence); failures are audited once per streak so a dead
   * server cannot flood the hash chain.
   */
  @ReactMethod
  fun reportResult(ok: Boolean, detail: String, promise: Promise) {
    if (ok) {
      failures = 0
      PuppyGuardService.notifyActivity()
    } else {
      failures += 1
      if (failures == 1 || failures % 10 == 0) {
        AuditLogModule.write("poll.failed", "连续失败 $failures 次：$detail", reactApplicationContext)
      }
    }
    promise.resolve(failures)
  }

  /**
   * Mirror the puppy's auto-rule list into the service. Rules only switch the
   * power tier; everything they do happens on the existing tick, so a rule
   * costs one small JSON parse per tick and never wakes the device.
   */
  @ReactMethod
  fun setAutoRules(json: String, promise: Promise) {
    try {
      val parsed = org.json.JSONArray(json)
      prefs.edit().putString(PuppyGuardService.PREF_AUTO_RULES, json).apply()
      PuppyGuardService.applyAutoRules(reactApplicationContext)
      promise.resolve(parsed.length())
    } catch (error: Exception) {
      promise.reject("auto_rules_failed", error.message, error)
    }
  }

  @ReactMethod
  fun getAutoRules(promise: Promise) {
    try {
      val raw = prefs.getString(PuppyGuardService.PREF_AUTO_RULES, "[]") ?: "[]"
      val map = Arguments.createMap()
      map.putString("rules", raw)
      map.putString(
        "active",
        prefs.getString(PuppyGuardService.PREF_AUTO_ACTIVE, "") ?: ""
      )
      promise.resolve(map)
    } catch (error: Exception) {
      promise.reject("auto_rules_read_failed", error.message, error)
    }
  }

  /**
   * One-shot catch-up signal left by [AutoStartReceiver] (boot, reconnect).
   * Returns the reason and clears it, so JS runs exactly one sync.
   */
  @ReactMethod
  fun consumePendingSync(promise: Promise) {
    try {
      promise.resolve(AutoStartBus.consume(reactApplicationContext))
    } catch (error: Exception) {
      promise.reject("pending_sync_failed", error.message, error)
    }
  }

  /**
   * The only DeviceAdmin action the app implements. No wipe, no password
   * policy, no silent install: locking the screen is the whole contract.
   */
  @ReactMethod
  fun lockNow(promise: Promise) {
    try {
      val manager =
        reactApplicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as
          DevicePolicyManager
      val component = ComponentName(reactApplicationContext, QiDeviceAdminReceiver::class.java)
      if (!manager.isAdminActive(component)) {
        promise.reject("device_admin_missing", "还需要开启设备管理员才能锁定屏幕")
        return
      }
      manager.lockNow()
      AuditLogModule.write("admin.lockNow", "已锁定屏幕", reactApplicationContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("lock_failed", error.message, error)
    }
  }

  // NativeEventEmitter bookkeeping so `new NativeEventEmitter()` stays quiet.
  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  private fun emitTick(payload: Map<String, Any?>) {
    val context = reactApplicationContext
    if (!context.hasActiveReactInstance()) return
    val map = Arguments.createMap()
    payload.forEach { (key, value) -> put(map, key, value) }
    runCatching { context.emitDeviceEvent("qiGuardTick", map) }
  }

  private fun put(map: WritableMap, key: String, value: Any?) {
    when (value) {
      null -> map.putNull(key)
      is Boolean -> map.putBoolean(key, value)
      is Int -> map.putInt(key, value)
      is Long -> map.putDouble(key, value.toDouble())
      is Double -> map.putDouble(key, value)
      is Float -> map.putDouble(key, value.toDouble())
      else -> map.putString(key, value.toString())
    }
  }
}
