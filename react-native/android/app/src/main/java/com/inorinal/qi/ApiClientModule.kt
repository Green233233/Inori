package com.inorinal.qi

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.Executors
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Native HTTP transport.
 *
 * Why native: self-hosted servers usually present a self-signed certificate, and
 * the app pins its SHA-256 fingerprint instead of shipping a CA. Requests also
 * never expose the account token to JS.
 *
 * Each request runs on its own pooled thread so a 25-300 s long poll can never
 * block other native module calls.
 */
class ApiClientModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val prefs = reactContext.getSharedPreferences("qi.net", Context.MODE_PRIVATE)
  private val pool = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "qi-http").apply { isDaemon = true }
  }

  /**
   * 按 pin 缓存 SSLSocketFactory。
   *
   * 以前每个请求都 `SSLContext.getInstance("TLS")` + `init()`，等于每次都新建一套
   * TLS 上下文：既慢，又让客户端 TLS 会话票据（session ticket）完全复用不了，
   * keep-alive 一失效就每次全量握手。
   */
  @Volatile private var cachedPin: String? = null
  @Volatile private var cachedFactory: javax.net.ssl.SSLSocketFactory? = null

  override fun getName(): String = "QiApiClient"

  @ReactMethod
  fun configure(baseUrl: String, pinSha256: String, promise: Promise) {
    prefs.edit()
      .putString("baseUrl", baseUrl.trimEnd('/'))
      .putString("pin", normalizePin(pinSha256))
      .apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun getConfig(promise: Promise) {
    val result = WritableNativeMap()
    result.putString("baseUrl", prefs.getString("baseUrl", "") ?: "")
    result.putString("pin", prefs.getString("pin", "") ?: "")
    promise.resolve(result)
  }

  @ReactMethod
  fun request(
    method: String,
    path: String,
    body: String?,
    token: String?,
    timeoutMs: Int,
    promise: Promise
  ) {
    val baseUrl = prefs.getString("baseUrl", "") ?: ""
    if (baseUrl.isEmpty()) {
      promise.reject("not_configured", "还没有设置服务器地址")
      return
    }
    val pin = prefs.getString("pin", "") ?: ""
    val payload = body?.toByteArray(Charsets.UTF_8)
    pool.execute {
      try {
        val result = execute(baseUrl + path, method, payload, token, timeoutMs, pin)
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("network_error", error.message ?: "网络请求失败", error)
      }
    }
  }

  private fun execute(
    url: String,
    method: String,
    payload: ByteArray?,
    token: String?,
    timeoutMs: Int,
    pin: String
  ): WritableNativeMap {
    val connection = URL(url).openConnection() as HttpURLConnection
    var keepAlive = false
    try {
      if (connection is HttpsURLConnection && pin.isNotEmpty()) {
        connection.sslSocketFactory = pinnedSocketFactory(pin)
        // The pin authenticates the peer; self-signed IP certificates rarely
        // carry a matching SAN, so hostname matching is delegated to the pin.
        connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
      }
      connection.requestMethod = method
      connection.connectTimeout = 15_000
      // 上限必须跟着「最长的合法请求」走：relay 长轮询会 hold wait+10 秒
      // （现在 wait=25 → 35 秒），日记 PUT 按体积算能到 120 秒。以前这里压在
      // 60 秒，把 JS 侧的 recordTimeoutMs 直接截断，稍大的日记必然超时。
      connection.readTimeout = timeoutMs.coerceIn(1_000, 120_000)
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      // 千万不要自己写 Accept-Encoding: gzip。
      // HttpURLConnection 自己加这个头时会顺带用 GZIPInputStream 解压；一旦我们
      // 手动设置，它就把「压缩过的字节」原样交出来，JS 侧 JSON.parse 失败，界面
      // 上只会看到「服务器返回了无法解析的数据」——而 Caddy 配了 encode gzip，
      // 凡是超过阈值的响应（例如绑定、长轮询）都会被压缩，于是时好时坏。
      if (!token.isNullOrEmpty()) {
        connection.setRequestProperty("Authorization", "Bearer $token")
      }
      if (payload != null) {
        connection.doOutput = true
        connection.setFixedLengthStreamingMode(payload.size)
        connection.outputStream.use { it.write(payload) }
      }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.use { readAll(it) } ?: ""
      keepAlive = true
      val result = WritableNativeMap()
      result.putInt("status", status)
      result.putString("body", text)
      return result
    } finally {
      // 成功时不要 disconnect：disconnect() 会关掉底层 socket，连接池也就
      // 白建了，下一次请求又得重新 TCP+TLS 三次握手（自签证书 + pin 尤其贵）。
      // 流已经在上面 use{} 关掉，HttpURLConnection 会自己把连接还给池子里。
      if (!keepAlive) {
        connection.disconnect()
      }
    }
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

  private fun normalizePin(raw: String): String =
    raw.trim().lowercase()
      .removePrefix("sha256:")
      .replace(":", "")
      .replace(" ", "")

  private fun pinnedSocketFactory(pin: String): javax.net.ssl.SSLSocketFactory {
    cachedFactory?.let { factory ->
      if (cachedPin == pin) {
        return factory
      }
    }
    val trustManager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("不支持客户端证书校验")
      }

      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        if (chain.isEmpty()) throw CertificateException("服务器证书链为空")
        val digest = MessageDigest.getInstance("SHA-256").digest(chain[0].encoded)
        val actual = digest.joinToString("") { "%02x".format(it) }
        if (actual != pin) {
          throw CertificateException("服务器证书指纹不匹配，请核对服务器指纹")
        }
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(trustManager), null)
    val factory = context.socketFactory
    cachedPin = pin
    cachedFactory = factory
    return factory
  }
}
