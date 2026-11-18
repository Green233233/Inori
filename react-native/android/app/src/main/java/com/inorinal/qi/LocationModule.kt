package com.inorinal.qi

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Address
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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
 *  - Reverse geocoding is best effort; a Geocoder failure returns
 *    `{ok:false}` instead of rejecting, because it needs network and is
 *    frequently unavailable (emulators, offline).
 */
class LocationModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "qi-location").apply { isDaemon = true }
  }
  private val prefs by lazy {
    reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  }

  override fun getName(): String = "QiLocation"

  @ReactMethod
  fun getLastKnown(promise: Promise) {
    if (!hasLocationPermission()) {
      promise.reject("location_permission_missing", "还没有定位权限")
      return
    }
    io.execute {
      try {
        promise.resolve(bestEffortFix())
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
    if (!hasLocationPermission()) {
      promise.reject("location_permission_missing", "还没有定位权限")
      return
    }
    io.execute {
      try {
        val manager =
          reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val recent = freshestKnown(manager)
        val gateOpen =
          System.currentTimeMillis() - prefs.getLong(PREF_LAST_NETWORK_AT, 0L) >= NETWORK_GATE_MS
        if (!allowNetwork || !gateOpen) {
          promise.resolve(toMap(recent, fresh = false, networkAttempted = false))
          return@execute
        }
        val fresh = requestSingle(manager, LocationManager.NETWORK_PROVIDER) ?: recent
        if (fresh != null) {
          prefs.edit().putLong(PREF_LAST_NETWORK_AT, System.currentTimeMillis()).apply()
        }
        promise.resolve(toMap(fresh ?: recent, fresh = fresh != null, networkAttempted = true))
      } catch (error: Exception) {
        promise.reject("location_failed", error.message, error)
      }
    }
  }

  @ReactMethod
  fun reverseGeocode(latitude: Double, longitude: Double, promise: Promise) {
    io.execute {
      val result = Arguments.createMap()
      try {
        @Suppress("DEPRECATION")
        val addresses: List<Address>? =
          Geocoder(reactApplicationContext, Locale.getDefault())
            .getFromLocation(latitude, longitude, 1)
        val first = addresses?.firstOrNull()
        if (first != null) {
          result.putBoolean("ok", true)
          result.putString("address", format(first))
          result.putString("city", first.locality ?: first.adminArea ?: "")
          result.putString("country", first.countryName ?: "")
        } else {
          result.putBoolean("ok", false)
          result.putString("reason", "没有解析到地址")
        }
      } catch (error: Exception) {
        // Geocoder needs a network service that many ROMs/emulators do not
        // ship; this must never look like a location failure.
        result.putBoolean("ok", false)
        result.putString("reason", error.message ?: "逆地理失败")
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
    val manager =
      reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val map = Arguments.createMap()
    map.putBoolean(
      "fine",
      ContextCompat.checkSelfPermission(
        reactApplicationContext,
        Manifest.permission.ACCESS_FINE_LOCATION
      ) == PackageManager.PERMISSION_GRANTED
    )
    map.putBoolean(
      "coarse",
      ContextCompat.checkSelfPermission(
        reactApplicationContext,
        Manifest.permission.ACCESS_COARSE_LOCATION
      ) == PackageManager.PERMISSION_GRANTED
    )
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

  private fun hasLocationPermission(): Boolean =
    ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED ||
      ContextCompat.checkSelfPermission(
        reactApplicationContext,
        Manifest.permission.ACCESS_COARSE_LOCATION
      ) == PackageManager.PERMISSION_GRANTED

  /** Cheapest possible answer: whatever another app already paid for. */
  private fun bestEffortFix(): WritableMap {
    val manager =
      reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    return toMap(freshestKnown(manager), fresh = false, networkAttempted = false)
  }

  private fun freshestKnown(manager: LocationManager): Location? {
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

  /** Single-shot request with a hard timeout; provider callback runs on main. */
  private fun requestSingle(manager: LocationManager, provider: String): Location? {
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
      val arrived = latch.await(FIX_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      if (arrived) latest[0] else null
    } catch (error: Exception) {
      null
    } finally {
      // Removing updates immediately is the whole point of "one fix": a
      // lingering listener would keep the provider (and GPS) hot.
      runCatching { manager.removeUpdates(listener) }
    }
  }

  private fun toMap(location: Location?, fresh: Boolean, networkAttempted: Boolean): WritableMap {
    val map = Arguments.createMap()
    if (location == null) {
      map.putBoolean("ok", false)
      map.putString("reason", "暂时没有可用的位置（被动定位需要其他应用先请求过）")
      map.putBoolean("fresh", false)
      map.putBoolean("networkAttempted", networkAttempted)
      return map
    }
    map.putBoolean("ok", true)
    map.putDouble("lat", location.latitude)
    map.putDouble("lng", location.longitude)
    map.putDouble("accuracy", location.accuracy.toDouble())
    map.putDouble("time", location.time.toDouble())
    map.putString("provider", location.provider ?: "")
    // Age is what the UI actually needs: "5 分钟前" beats a raw timestamp.
    map.putDouble("ageMs", (System.currentTimeMillis() - location.time).toDouble())
    map.putBoolean("fresh", fresh)
    map.putBoolean("networkAttempted", networkAttempted)
    return map
  }

  private fun format(address: Address): String {
    val parts =
      listOfNotNull(
        address.adminArea,
        address.locality ?: address.subAdminArea,
        address.subLocality,
        address.thoroughfare,
        address.subThoroughfare
      )
    return if (parts.isEmpty()) address.getAddressLine(0) ?: "" else parts.joinToString("")
  }

  companion object {
    private const val PREFS = "qi.location"
    private const val PREF_NETWORK_ENABLED = "networkFixEnabled"
    private const val PREF_LAST_NETWORK_AT = "lastNetworkAt"

    /** 30-minute gate: an explicit user-facing promise, not a timer. */
    private const val NETWORK_GATE_MS = 30L * 60L * 1000L

    /** A single fix that takes longer than this is abandoned. */
    private const val FIX_TIMEOUT_MS = 20_000L
  }
}
