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

  /**
   * 配对上下文：常驻服务要在 JS 不在的时候替主人执行只读命令，必须先知道
   * 「用哪把钥匙、加密给谁」。两项都不是秘密（公钥 + 配对号），所以落在
   * `qi.link` 的普通 prefs 里；真正的解密仍要经过 Keystore 里的私钥。
   */
  @ReactMethod
  fun setPairContext(pairId: String, peerPublicB64: String, promise: Promise) {
    if (pairId.isBlank() || peerPublicB64.isBlank()) {
      promise.reject("invalid_argument", "缺少配对号或对方公钥")
      return
    }
    try {
      QiLinkService.setPairContext(reactApplicationContext, pairId, peerPublicB64)
      promise.resolve(true)
    } catch (error: Throwable) {
      // 只回报异常类型：消息里可能带请求细节。
      promise.reject("link_pair_context_failed", error.javaClass.simpleName)
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
      // 约定上下文没同步过来时，JS 不能把只读命令让给原生（没人会执行）。
      result.putBoolean("pairReady", snapshot["pairReady"] as? Boolean ?: false)
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("link_status_failed", error.javaClass.simpleName)
    }
  }
}
