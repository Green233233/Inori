package com.inorinal.qi

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 只负责「启停 + 读状态」，真正的轮询在 [QiLinkService] 的后台线程里。
 *
 * 令牌和服务器地址由 JS 从当前会话里递进来（内存里过一遍就进 Intent），
 * 这里不落盘、不打印：服务只在需要时才把它交给请求头/Keystore。
 */
class LinkServiceModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "QiLink"

  @ReactMethod
  fun start(token: String, baseUrl: String, promise: Promise) {
    if (token.isBlank() || baseUrl.isBlank()) {
      promise.reject("invalid_argument", "缺少令牌或服务器地址")
      return
    }
    try {
      QiLinkService.start(reactApplicationContext, token, baseUrl)
      promise.resolve(true)
    } catch (error: Throwable) {
      // 只回报异常类型：消息里可能带请求细节。
      promise.reject("link_start_failed", error.javaClass.simpleName)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      QiLinkService.stop(reactApplicationContext)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("link_stop_failed", error.javaClass.simpleName)
    }
  }

  @ReactMethod
  fun status(promise: Promise) {
    try {
      val snapshot = QiLinkService.snapshot(reactApplicationContext)
      val result = Arguments.createMap()
      result.putBoolean("running", snapshot["running"] as? Boolean ?: false)
      result.putBoolean("foreground", snapshot["foreground"] as? Boolean ?: false)
      result.putDouble("cursor", (snapshot["cursor"] as? Long)?.toDouble() ?: 0.0)
      result.putDouble("lastPollAt", (snapshot["lastPollAt"] as? Long)?.toDouble() ?: 0.0)
      result.putString("lastError", snapshot["lastError"] as? String ?: "")
      result.putBoolean("backlog", snapshot["backlog"] as? Boolean ?: false)
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("link_status_failed", error.javaClass.simpleName)
    }
  }
}
