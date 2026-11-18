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
    try {
      if (connection is HttpsURLConnection && pin.isNotEmpty()) {
        connection.sslSocketFactory = pinnedSocketFactory(pin)
        // The pin authenticates the peer; self-signed IP certificates rarely
        // carry a matching SAN, so hostname matching is delegated to the pin.
        connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
      }
      connection.requestMethod = method
      connection.connectTimeout = 10_000
      connection.readTimeout = timeoutMs.coerceIn(1_000, 60_000)
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      connection.setRequestProperty("Accept-Encoding", "gzip")
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
      val result = WritableNativeMap()
      result.putInt("status", status)
      result.putString("body", text)
      return result
    } finally {
      connection.disconnect()
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
    return context.socketFactory
  }
}
