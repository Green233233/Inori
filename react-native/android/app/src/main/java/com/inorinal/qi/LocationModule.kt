package com.inorinal.qi

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Address
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Location with an explicit power story.
 *
 *  - PASSIVE_PROVIDER is free: it only reuses fixes some other app already
 *    requested, so reading it costs nothing and gives us a "last known" value
 *    without a single GPS wakeup.
 *  - NETWORK_PROVIDER is opt-in and rate-limited to one request per 30 minutes.
 *    There is no background timer: the gate is checked when JS asks
 *    (`reportOnce`), so a 30-minute cadence can never turn into a minute
 *    cadence, and no alarm is ever scheduled.
 *  - Reverse geocoding is best effort; Geocoder failure falls back to Nominatim
 *    and then to `{ok:false}` instead of rejecting, because it needs network and
 *    is frequently unavailable (emulators, offline).
 *
 * The actual work lives in [QiLocationEngine] so the常驻 relay service can ask
 * for a fix and an address without a React bridge (see QiLinkService).
 */
class LocationModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "qi-location").apply { isDaemon = true }
  }
  private val prefs by lazy { QiLocationEngine.prefs(reactApplicationContext) }

  override fun getName(): String = "QiLocation"

  @ReactMethod
  fun getLastKnown(promise: Promise) {
    if (!QiLocationEngine.hasPermission(reactApplicationContext)) {
      promise.reject("location_permission_missing", "还没有定位权限")
      return
    }
    io.execute {
      try {
        promise.resolve(
          QiLocationEngine.toMap(
            QiLocationEngine.bestEffortFix(reactApplicationContext)
          )
        )
      } catch (error: Exception) {
        promise.reject("location_failed", error.message, error)
      }
    }
  }

  /**
   * One fix, now. `allowNetwork` still obeys the 30-minute gate; returns the
   * cached/passive fix with `fresh=false` when the gate blocks the request.
   */
  @ReactMethod
  fun reportOnce(allowNetwork: Boolean, promise: Promise) {
    if (!QiLocationEngine.hasPermission(reactApplicationContext)) {
      promise.reject("location_permission_missing", "还没有定位权限")
      return
    }
    io.execute {
      try {
        val manager = manager()
        val recent = QiLocationEngine.freshestKnown(manager)
        val gateOpen =
          System.currentTimeMillis() - prefs.getLong(PREF_LAST_NETWORK_AT, 0L) >= NETWORK_GATE_MS
        if (!allowNetwork || !gateOpen) {
          promise.resolve(
            QiLocationEngine.toFix(recent, fresh = false, networkAttempted = false).toMap()
          )
          return@execute
        }
        val fresh =
          QiLocationEngine.requestSingle(
            manager,
            LocationManager.NETWORK_PROVIDER,
            QiLocationEngine.FIX_TIMEOUT_MS
          ) ?: recent
        if (fresh != null) {
          prefs.edit().putLong(PREF_LAST_NETWORK_AT, System.currentTimeMillis()).apply()
        }
        promise.resolve(
          QiLocationEngine.toFix(fresh, fresh = fresh != null, networkAttempted = true).toMap()
        )
      } catch (error: Exception) {
        promise.reject("location_failed", error.message, error)
      }
    }
  }

  /**
   * One deliberate fix, used when the user taps 定位 in the control center.
   *
   * Order matters for power: a fix newer than [QiLocationEngine.FRESH_ENOUGH_MS]
   * is returned as is (no radio at all); otherwise we walk GPS → NETWORK →
   * PASSIVE inside a single 12 s budget, so three providers can never stack
   * into 36 s of radio time. Every listener is removed immediately.
   */
  @ReactMethod
  fun locate(promise: Promise) {
    if (!QiLocationEngine.hasPermission(reactApplicationContext)) {
      promise.reject("location_permission_missing", "还没有定位权限")
      return
    }
    io.execute {
      try {
        promise.resolve(QiLocationEngine.locateNow(reactApplicationContext).toMap())
      } catch (error: Exception) {
        promise.reject("location_failed", error.message, error)
      }
    }
  }

  @ReactMethod
  fun reverseGeocode(latitude: Double, longitude: Double, promise: Promise) {
    io.execute {
      val place =
        try {
          QiLocationEngine.reverseGeocode(reactApplicationContext, latitude, longitude)
        } catch (error: Exception) {
          // 逆地理永远不能把定位判失败：最坏也只是没有好看的文案。
          Log.w(QiLocationEngine.TAG, "reverse_geocode_failed ${error.javaClass.simpleName}")
          QiLocationEngine.QiPlace(ok = false, reason = error.message ?: "逆地理失败")
        }
      val result = Arguments.createMap()
      result.putBoolean("ok", place.ok)
      if (place.ok) {
        result.putString("address", place.address)
        result.putString("city", place.city)
        result.putString("country", place.country)
        result.putString("source", place.source)
      } else {
        result.putString("reason", place.reason.ifEmpty { "逆地理失败" })
      }
      promise.resolve(result)
    }
  }

  @ReactMethod
  fun setNetworkFixEnabled(enabled: Boolean, promise: Promise) {
    prefs.edit().putBoolean(PREF_NETWORK_ENABLED, enabled).apply()
    promise.resolve(enabled)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val manager = manager()
    val map = Arguments.createMap()
    map.putBoolean("fine", QiLocationEngine.hasFinePermission(reactApplicationContext))
    map.putBoolean("coarse", QiLocationEngine.hasCoarsePermission(reactApplicationContext))
    map.putBoolean("gpsEnabled", runCatching { manager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false))
    map.putBoolean(
      "networkEnabled",
      runCatching { manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false)
    )
    map.putBoolean("networkFixEnabled", prefs.getBoolean(PREF_NETWORK_ENABLED, false))
    map.putDouble("lastNetworkAt", prefs.getLong(PREF_LAST_NETWORK_AT, 0L).toDouble())
    map.putDouble("networkGateMs", NETWORK_GATE_MS.toDouble())
    promise.resolve(map)
  }

  // ---------------------------------------------------------------- internals

  private fun manager(): LocationManager =
    reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager

  companion object {
    private const val PREF_NETWORK_ENABLED = "networkFixEnabled"
    private const val PREF_LAST_NETWORK_AT = "lastNetworkAt"

    /** 30-minute gate: an explicit user-facing promise, not a timer. */
    private const val NETWORK_GATE_MS = 30L * 60L * 1000L
  }
}

/**
 * 纯逻辑定位引擎：只依赖 Context，模块层与常驻服务共用。
 *
 * 返回值刻意不是 WritableMap / JSONObject，而是数据类：调用方各自决定怎么
 * 落地（React bridge 或 relay 回包），避免两套实现漂移。
 */
internal object QiLocationEngine {
  const val TAG = "QiLocation"

  private const val PREFS = "qi.location"
  private const val PREF_GEO_PREFIX = "geocode."

  /** A fix younger than this needs no radio at all. */
  const val FRESH_ENOUGH_MS = 5L * 60L * 1000L

  /** 单个 provider 最多等 12s；整体也只给 12s（见 [locateNow]）。 */
  const val FIX_TIMEOUT_MS = 12_000L

  private const val NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/reverse"
  private const val USER_AGENT = "Inorinal/0.6.3 (Android; contact: qi@inorinal.local)"
  private const val HTTP_CONNECT_TIMEOUT_MS = 3_000
  private const val HTTP_READ_TIMEOUT_MS = 3_000

  /** 逆地理缓存 24 小时：同一栋楼反复点定位不该反复打 Nominatim。 */
  private const val GEO_CACHE_TTL_MS = 24L * 60L * 60L * 1000L
  private const val GEO_CACHE_KEYS = "geocode"

  private const val PREF_LAST_NETWORK_AT = "lastNetworkAt"

  fun prefs(context: Context): android.content.SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun hasFinePermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED

  fun hasCoarsePermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED

  fun hasPermission(context: Context): Boolean =
    hasFinePermission(context) || hasCoarsePermission(context)

  fun manager(context: Context): LocationManager =
    context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

  /** Cheapest possible answer: whatever another app already paid for. */
  fun freshestKnown(manager: LocationManager): Location? {
    val candidates =
      listOf(
          LocationManager.PASSIVE_PROVIDER,
          LocationManager.NETWORK_PROVIDER,
          LocationManager.GPS_PROVIDER
        )
        .mapNotNull { provider ->
          runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
        }
    return candidates.maxByOrNull { it.time }
  }

  fun bestEffortFix(context: Context): QiFix =
    toFix(freshestKnown(manager(context)), fresh = false, networkAttempted = false)

  /**
   * 一次主动定位。
   *
   * `freshestKnown` 在 5 分钟内直接返回；否则按 GPS → NETWORK → PASSIVE 逐个
   * 尝试，每个 provider 只能用掉「剩余预算」，总时长不超过 [FIX_TIMEOUT_MS]。
   * 某个 provider 未启用/无权限时跳过，而不是让整次定位直接失败。
   */
  fun locateNow(context: Context): QiFix {
    val manager = manager(context)
    val recent = freshestKnown(manager)
    if (recent != null && System.currentTimeMillis() - recent.time <= FRESH_ENOUGH_MS) {
      return toFix(recent, fresh = true, networkAttempted = false)
    }
    val deadlineAt = SystemClock.elapsedRealtime() + FIX_TIMEOUT_MS
    val providers =
      listOf(
        LocationManager.GPS_PROVIDER to hasFinePermission(context),
        LocationManager.NETWORK_PROVIDER to hasPermission(context),
        LocationManager.PASSIVE_PROVIDER to hasPermission(context)
      )
    var fixed: Location? = null
    for ((provider, permitted) in providers) {
      if (!permitted) continue
      val remaining = deadlineAt - SystemClock.elapsedRealtime()
      if (remaining <= 0L) break
      fixed = requestSingle(manager, provider, minOf(FIX_TIMEOUT_MS, remaining))
      if (fixed != null) break
    }
    if (fixed != null) {
      prefs(context)
        .edit()
        .putLong(PREF_LAST_NETWORK_AT, System.currentTimeMillis())
        .apply()
      return toFix(fixed, fresh = true, networkAttempted = true)
    }
    return toFix(recent, fresh = false, networkAttempted = true)
  }

  /** Single-shot request with a hard timeout; provider callback runs on main. */
  fun requestSingle(manager: LocationManager, provider: String, timeoutMs: Long): Location? {
    if (timeoutMs <= 0L) return null
    if (!runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false)) return null
    val latch = CountDownLatch(1)
    val latest = arrayOfNulls<Location>(1)
    val listener =
      object : LocationListener {
        override fun onLocationChanged(location: Location) {
          latest[0] = location
          latch.countDown()
        }

        @Deprecated("Required by the platform interface")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

        override fun onProviderEnabled(provider: String) = Unit

        override fun onProviderDisabled(provider: String) = Unit
      }
    return try {
      manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
      val arrived = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
      if (arrived) latest[0] else null
    } catch (error: Exception) {
      Log.w(TAG, "request_single_failed provider=$provider ${error.javaClass.simpleName}")
      null
    } finally {
      // Removing updates immediately is the whole point of "one fix": a
      // lingering listener would keep the provider (and GPS) hot.
      runCatching { manager.removeUpdates(listener) }
    }
  }

  // ------------------------------------------------------------ reverse geo

  data class QiPlace(
    val ok: Boolean,
    val address: String = "",
    val city: String = "",
    val country: String = "",
    val source: String = "",
    val reason: String = ""
  )

  /**
   * Geocoder → Nominatim → 失败。
   *
   * 成功结果（含来源）写 `qi.location` 的 prefs 缓存，键是坐标四舍五入到 4 位，
   * 24 小时内同一坐标直接复用，避免主人连点「定位」把 Nominatim 打爆。
   * 全程在调用方既有的单线程 executor 里执行，绝不碰主线程。
   */
  fun reverseGeocode(context: Context, latitude: Double, longitude: Double): QiPlace {
    val key = cacheKey(latitude, longitude)
    cachedGeocode(context, key)?.let { return it }

    val geocoded = geocoder(context, latitude, longitude)
    if (geocoded != null && geocoded.address.isNotEmpty()) {
      cacheGeocode(context, key, geocoded)
      return geocoded
    }
    val nominatim = nominatim(context, latitude, longitude)
    if (nominatim != null) {
      cacheGeocode(context, key, nominatim)
      return nominatim
    }
    return QiPlace(ok = false, reason = geocoded?.reason ?: "没有解析到地址")
  }

  private fun cacheKey(latitude: Double, longitude: Double): String =
    PREF_GEO_PREFIX + String.format(Locale.US, "%.4f,%.4f", latitude, longitude)

  private fun cachedGeocode(context: Context, key: String): QiPlace? {
    val raw = prefs(context).getString(key, null) ?: return null
    val cached =
      runCatching { JSONObject(raw) }.getOrNull()
        ?: return null
    val at = cached.optLong("at", 0L)
    if (at <= 0L || System.currentTimeMillis() - at > GEO_CACHE_TTL_MS) return null
    val address = cached.optString("address", "")
    if (address.isEmpty()) return null
    return QiPlace(
      ok = true,
      address = address,
      city = cached.optString("city", ""),
      country = cached.optString("country", ""),
      source = cached.optString("source", "geocoder")
    )
  }

  private fun cacheGeocode(context: Context, key: String, place: QiPlace) {
    val value =
      JSONObject()
        .put("address", place.address)
        .put("city", place.city)
        .put("country", place.country)
        .put("source", place.source)
        .put("at", System.currentTimeMillis())
    prefs(context).edit().putString(key, value.toString()).apply()
  }

  private fun geocoder(context: Context, latitude: Double, longitude: Double): QiPlace? {
    return try {
      @Suppress("DEPRECATION")
      val addresses: List<Address>? =
        Geocoder(context, Locale.getDefault()).getFromLocation(latitude, longitude, 1)
      val first = addresses?.firstOrNull() ?: return null
      QiPlace(
        ok = true,
        address = format(first),
        city = first.locality ?: first.adminArea ?: "",
        country = first.countryName ?: "",
        source = "geocoder"
      )
    } catch (error: Exception) {
      // Geocoder needs a network service that many ROMs/emulators do not ship;
      // this must never look like a location failure, and coordinates stay out
      // of the log.
      Log.w(TAG, "geocoder_failed ${error.javaClass.simpleName}")
      null
    }
  }

  /** Nominatim reverse geocoding: `display_name` 优先，否则拼 address 组件。 */
  private fun nominatim(context: Context, latitude: Double, longitude: Double): QiPlace? {
    var connection: HttpURLConnection? = null
    return try {
      val url =
        URL(
          "$NOMINATIM_ENDPOINT?format=jsonv2&accept-language=zh-CN" +
            "&lat=$latitude&lon=$longitude"
        )
      connection = url.openConnection() as HttpURLConnection
      connection.requestMethod = "GET"
      connection.connectTimeout = HTTP_CONNECT_TIMEOUT_MS
      connection.readTimeout = HTTP_READ_TIMEOUT_MS
      connection.setRequestProperty("User-Agent", USER_AGENT)
      connection.setRequestProperty("Accept", "application/json")
      val status = connection.responseCode
      if (status !in 200..299) {
        Log.w(TAG, "nominatim_http_$status")
        return null
      }
      val text = connection.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8)
      val json = JSONObject(text)
      val display = json.optString("display_name", "").trim()
      val address = json.optJSONObject("address")
      val city =
        address?.optString("city", "")?.ifEmpty { address.optString("state", "") } ?: ""
      val country = address?.optString("country", "") ?: ""
      val composed =
        if (display.isNotEmpty()) {
          display
        } else {
          listOf("country", "state", "city", "suburb", "road")
            .map { address?.optString(it, "") ?: "" }
            .filter { it.isNotEmpty() }
            .joinToString("")
        }
      if (composed.isEmpty()) return null
      QiPlace(ok = true, address = composed, city = city, country = country, source = "nominatim")
    } catch (error: Exception) {
      Log.w(TAG, "nominatim_failed ${error.javaClass.simpleName}")
      null
    } finally {
      runCatching { connection?.disconnect() }
    }
  }

  private fun format(address: Address): String {
    // Geocoder 已经返回本地化的完整地址（中文 ROM 是「北京市海淀区中关村大街
    // 27 号」这种），优先用它；少数 ROM 的 addressLine 为空，再用行政区/街道
    // 组件拼一个兜底，保证 reverseGeocode 尽量不返回空串。
    val line = address.getAddressLine(0)?.trim().orEmpty()
    if (line.isNotEmpty()) return line
    val parts =
      listOfNotNull(
        address.adminArea,
        address.locality ?: address.subAdminArea,
        address.subLocality,
        address.thoroughfare,
        address.subThoroughfare
      )
    return parts.joinToString("")
  }

  // ------------------------------------------------------------ conversions

  data class QiFix(
    val ok: Boolean,
    val lat: Double?,
    val lng: Double?,
    val accuracy: Double,
    val time: Long,
    val provider: String,
    val ageMs: Long,
    val fresh: Boolean,
    val networkAttempted: Boolean,
    val reason: String?
  ) {
    fun toMap(): WritableMap {
      val map = Arguments.createMap()
      if (!ok || lat == null || lng == null) {
        map.putBoolean("ok", false)
        map.putString("reason", reason ?: "还没拿到坐标：请确认系统定位开关已打开，然后再点一次")
        map.putBoolean("fresh", false)
        map.putBoolean("networkAttempted", networkAttempted)
        return map
      }
      map.putBoolean("ok", true)
      map.putDouble("lat", lat)
      map.putDouble("lng", lng)
      map.putDouble("accuracy", accuracy)
      map.putDouble("time", time.toDouble())
      map.putString("provider", provider)
      // Age is what the UI actually needs: "5 分钟前" beats a raw timestamp.
      map.putDouble("ageMs", ageMs.toDouble())
      map.putBoolean("fresh", fresh)
      map.putBoolean("networkAttempted", networkAttempted)
      return map
    }

    /** relay `command.reply` 里的 data 形状；坐标永远只在加密回包里。 */
    fun toJson(): JSONObject {
      val json = JSONObject()
      if (!ok || lat == null || lng == null) {
        json.put("ok", false)
        json.put("reason", reason ?: "还没拿到坐标：请确认系统定位开关已打开，然后再点一次")
        json.put("fresh", false)
        json.put("networkAttempted", networkAttempted)
        return json
      }
      json.put("ok", true)
      json.put("lat", lat)
      json.put("lng", lng)
      json.put("accuracy", accuracy)
      json.put("time", time.toDouble())
      json.put("provider", provider)
      json.put("ageMs", ageMs.toDouble())
      json.put("fresh", fresh)
      json.put("networkAttempted", networkAttempted)
      return json
    }
  }

  fun toFix(location: Location?, fresh: Boolean, networkAttempted: Boolean): QiFix {
    if (location == null) {
      return QiFix(
        ok = false,
        lat = null,
        lng = null,
        accuracy = 0.0,
        time = 0L,
        provider = "",
        ageMs = 0L,
        fresh = false,
        networkAttempted = networkAttempted,
        reason = "还没拿到坐标：请确认系统定位开关已打开，然后再点一次"
      )
    }
    return QiFix(
      ok = true,
      lat = location.latitude,
      lng = location.longitude,
      accuracy = location.accuracy.toDouble(),
      time = location.time,
      provider = location.provider ?: "",
      ageMs = System.currentTimeMillis() - location.time,
      fresh = fresh,
      networkAttempted = networkAttempted,
      reason = null
    )
  }

  fun toMap(fix: QiFix): WritableMap = fix.toMap()

  /**
   * 与 JS `describeFix`（src/sync/commands.ts:165）同形：补 address /
   * addressSource / geoUri。逆地理失败时退回「纬度,经度」，坐标仍然可用。
   */
  fun describeJson(context: Context, fix: QiFix): JSONObject {
    val json = fix.toJson()
    val lat = fix.lat
    val lng = fix.lng
    if (!fix.ok || lat == null || lng == null) return json
    val place = reverseGeocode(context, lat, lng)
    val rawAddress = if (place.ok) place.address.trim() else ""
    val coordinateText = String.format(Locale.US, "%.5f, %.5f", lat, lng)
    val address = rawAddress.ifEmpty { coordinateText }
    json.put("address", address)
    json.put("addressSource", if (rawAddress.isNotEmpty()) "geocoder" else "coordinates")
    json.put(
      "geoUri",
      "geo:$lat,$lng?q=$lat,$lng(${Uri.encode(address)})"
    )
    return json
  }
}
