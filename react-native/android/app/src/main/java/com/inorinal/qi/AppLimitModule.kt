package com.inorinal.qi

import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import org.json.JSONObject

/**
 * RN 桥：`QiLimits`。
 *
 * 只做三件事——把名单写进 [AppLimitWatcher]、把当前状态读回去、把主人手动输入
 * 的包名解析成应用名。拦截本身完全在原生侧完成，JS 不需要参与轮询，因此即使
 * RN 进程被系统杀掉，只要常驻服务还在，限制就仍然生效。
 */
class AppLimitModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "QiLimits"

    /** 写入名单；服务在跑时 [AppLimitWatcher] 会立即重新排期。 */
    @ReactMethod
    fun setRules(json: String, promise: Promise) {
        try {
            if (!AppLimitWatcher.applyRules(reactApplicationContext, json)) {
                promise.reject("limits_invalid", "限制名单格式不正确")
                return
            }
            val result = Arguments.createMap()
            result.putBoolean("ok", true)
            promise.resolve(result)
        } catch (error: Exception) {
            Log.w(TAG, "setRules 失败", error)
            promise.reject("limits_failed", error.message, error)
        }
    }

    /** 读取当前落盘的名单，供主人端回显与小狗端上报。 */
    @ReactMethod
    fun getRules(promise: Promise) {
        try {
            val snapshot = JSONObject(AppLimitWatcher.snapshot(reactApplicationContext))
            val rules = Arguments.createMap()
            rules.putBoolean("enabled", snapshot.optBoolean("enabled", false))
            rules.putArray("blocked", blockedToArray(snapshot.optJSONArray("blocked")))
            rules.putDouble("updatedAt", snapshot.optLong("updated_at", 0L).toDouble())

            val result = Arguments.createMap()
            result.putBoolean("ok", true)
            result.putMap("rules", rules)
            promise.resolve(result)
        } catch (error: Exception) {
            Log.w(TAG, "getRules 失败", error)
            promise.reject("limits_failed", error.message, error)
        }
    }

    /** 状态：是否启用、名单长度、是否正在轮询、是否允许悬浮窗。 */
    @ReactMethod
    fun getStatus(promise: Promise) {
        try {
            val snapshot = JSONObject(AppLimitWatcher.snapshot(reactApplicationContext))
            val result = Arguments.createMap()
            result.putBoolean("ok", true)
            result.putBoolean("enabled", snapshot.optBoolean("enabled", false))
            result.putInt("blockedCount", snapshot.optJSONArray("blocked")?.length() ?: 0)
            result.putBoolean("watching", AppLimitWatcher.isWatching())
            result.putBoolean("overlayAllowed", Settings.canDrawOverlays(reactApplicationContext))
            promise.resolve(result)
        } catch (error: Exception) {
            Log.w(TAG, "getStatus 失败", error)
            promise.reject("limits_failed", error.message, error)
        }
    }

    /**
     * 把主人手动输入的包名解析成应用名；未安装时 installed=false、label 回退为包名。
     * 只查单个包，不做全量枚举。
     */
    @ReactMethod
    fun resolveLabel(pkg: String, promise: Promise) {
        val trimmed = pkg.trim()
        if (trimmed.isBlank()) {
            promise.reject("limits_pkg_empty", "包名不能为空")
            return
        }
        val manager = reactApplicationContext.packageManager
        try {
            val info = manager.getApplicationInfo(trimmed, 0)
            val label = manager.getApplicationLabel(info).toString()
            promise.resolve(labelResult(trimmed, label, installed = true))
        } catch (error: PackageManager.NameNotFoundException) {
            promise.resolve(labelResult(trimmed, trimmed, installed = false))
        } catch (error: Exception) {
            Log.w(TAG, "解析应用名失败：$trimmed", error)
            promise.reject("limits_failed", error.message, error)
        }
    }

    // ---------------------------------------------------------------- helpers

    private fun blockedToArray(blocked: JSONArray?): com.facebook.react.bridge.WritableArray {
        val array = Arguments.createArray()
        if (blocked == null) return array
        for (index in 0 until blocked.length()) {
            val item = blocked.optJSONObject(index) ?: continue
            val entry = Arguments.createMap()
            entry.putString("pkg", item.optString("pkg", ""))
            entry.putString("label", item.optString("label", ""))
            array.pushMap(entry)
        }
        return array
    }

    private fun labelResult(
        pkg: String,
        label: String,
        installed: Boolean,
    ): com.facebook.react.bridge.WritableMap {
        val result = Arguments.createMap()
        result.putBoolean("ok", true)
        result.putString("pkg", pkg)
        result.putString("label", label)
        result.putBoolean("installed", installed)
        return result
    }

    companion object {
        private const val TAG = "QiLimits"
    }
}
