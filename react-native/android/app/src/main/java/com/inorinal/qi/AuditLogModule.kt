package com.inorinal.qi

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.Executors

/**
 * JS surface for the local hash-chained [AuditLog].
 *
 * Every file operation runs on a single dedicated thread: the audit log is
 * append-only and small, but reading a 2 MB file must never touch the JS thread
 * or the guard loop.
 */
class AuditLogModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "qi-audit").apply { isDaemon = true }
  }

  override fun getName(): String = "QiAudit"

  @ReactMethod
  fun append(type: String, detail: String, promise: Promise) {
    io.execute {
      try {
        val (seq, hash) = AuditLog.append(reactApplicationContext, type, detail)
        val result = Arguments.createMap()
        result.putInt("seq", seq.toInt())
        result.putString("hash", hash)
        result.putDouble("at", System.currentTimeMillis().toDouble())
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("audit_append_failed", error.message, error)
      }
    }
  }

  @ReactMethod
  fun read(limit: Int, offset: Int, promise: Promise) {
    io.execute {
      try {
        val records = AuditLog.read(reactApplicationContext, limit, offset)
        val array = Arguments.createArray()
        records.forEach { array.pushMap(toMap(it)) }
        promise.resolve(array)
      } catch (error: Exception) {
        promise.reject("audit_read_failed", error.message, error)
      }
    }
  }

  @ReactMethod
  fun export(promise: Promise) {
    io.execute {
      try {
        val file = AuditLog.export(reactApplicationContext)
        if (!file.exists()) {
          promise.reject("audit_empty", "还没有任何审计记录")
          return@execute
        }
        val bytes = file.readBytes()
        val result = Arguments.createMap()
        result.putString("path", file.absolutePath)
        result.putString("base64", B64.encode(bytes))
        result.putInt("count", AuditLog.count(reactApplicationContext))
        result.putString("sha256", AuditLog.sha256(file))
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("audit_export_failed", error.message, error)
      }
    }
  }

  /** Recomputes the hash chain; JS shows the verdict in the 券设置/透明页. */
  @ReactMethod
  fun verifyChain(promise: Promise) {
    io.execute {
      try {
        val result = AuditLog.verifyChain(reactApplicationContext)
        val map = Arguments.createMap()
        map.putBoolean("valid", result.valid)
        map.putInt("brokenAt", result.brokenAt)
        map.putInt("count", result.count)
        promise.resolve(map)
      } catch (error: Exception) {
        promise.reject("audit_verify_failed", error.message, error)
      }
    }
  }

  private fun toMap(record: org.json.JSONObject): WritableMap {
    val map = Arguments.createMap()
    map.putInt("seq", record.optInt("seq", 0))
    map.putDouble("at", record.optLong("at", 0L).toDouble())
    map.putString("type", record.optString("type", ""))
    map.putString("detail", record.optString("detail", ""))
    map.putString("prevHash", record.optString("prevHash", ""))
    map.putString("hash", record.optString("hash", ""))
    return map
  }

  /** Convenience for native code paths (screenshot) that must not depend on JS. */
  companion object {
    fun write(type: String, detail: String, context: android.content.Context) {
      runCatching { AuditLog.append(context, type, detail) }
    }
  }
}
