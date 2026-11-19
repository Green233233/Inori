package com.inorinal.qi

import android.app.AppOpsManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/**
 * Permission center for the ten capabilities 祈 may ask for.
 *
 * Design notes:
 *  - Every check is read-only and cheap; nothing here starts a service or
 *    touches the network.
 *  - `openSettings` is how we ask: the app never tries to talk the user into
 *    granting by itself, it sends them to the exact system screen so the grant
 *    is visibly made (and later revocable) in Settings.
 *  - `revoke` is honest about what is possible: only the device admin can be
 *    removed by us (via the system's own confirmation dialog); battery
 *    optimisation, notification access and overlay have no programmatic
 *    "ungrant", so we report `needsUserAction` instead of pretending.
 *  - The checks themselves live in the companion object and take a [Context],
 *    so [QiLinkService] can answer `permissions.snapshot` without a running
 *    React bridge (and without a second copy of these rules).
 */
class PermissionCenterModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "QiDevicePermissions"

  @ReactMethod
  fun getSnapshot(promise: Promise) {
    try {
      val array = Arguments.createArray()
      snapshot(reactApplicationContext).forEach { row ->
        val map = Arguments.createMap()
        map.putString("key", row.first)
        map.putBoolean("granted", row.second)
        array.pushMap(map)
      }
      promise.resolve(array)
    } catch (error: Exception) {
      promise.reject("permission_snapshot_failed", error.message, error)
    }
  }

  @ReactMethod
  fun getStatus(key: String, promise: Promise) {
    try {
      val map = Arguments.createMap()
      map.putString("key", key)
      map.putBoolean("granted", isGranted(reactApplicationContext, key))
      map.putBoolean("revocable", key == KEY_DEVICE_ADMIN)
      promise.resolve(map)
    } catch (error: Exception) {
      promise.reject("permission_status_failed", error.message, error)
    }
  }

  /**
   * Returns true when a settings activity was actually launched. A false here
   * means the ROM has no such screen (rare) — JS should fall back to the app
   * details page.
   */
  @ReactMethod
  fun openSettings(key: String, promise: Promise) {
    try {
      val intent = settingsIntent(reactApplicationContext, key)
      if (intent == null) {
        promise.resolve(false)
        return
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (ignored: Exception) {
      // A ROM that hides the screen must not crash the settings page.
      promise.resolve(false)
    }
  }

  /**
   * Opens the system "App info → Permissions" screen for this app: the one
   * place that lists every runtime permission we ask for. Used by the puppy
   * home card so a single tap lands next to the real switches instead of a
   * per-permission detour.
   */
  @ReactMethod
  fun openAppSettings(promise: Promise) {
    try {
      val intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = Uri.fromParts("package", reactApplicationContext.packageName, null)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (ignored: Exception) {
      promise.resolve(false)
    }
  }

  /** Batch variant used when the onboarding page walks the list once. */
  @ReactMethod
  fun openSettingsFor(keys: ReadableArray, promise: Promise) {
    // One screen per call: launching several activities in a burst is how
    // Android ends up showing the wrong screen last.
    var launched = false
    for (index in 0 until keys.size()) {
      val key = keys.getString(index) ?: continue
      val intent = settingsIntent(reactApplicationContext, key) ?: continue
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      launched = runCatching { reactApplicationContext.startActivity(intent) }.isSuccess
      break
    }
    promise.resolve(launched)
  }

  @ReactMethod
  fun revoke(key: String, promise: Promise) {
    val result = Arguments.createMap()
    result.putString("key", key)
    if (key == KEY_DEVICE_ADMIN) {
      // An app may always drop its own admin rights, and that is the only path
      // that works everywhere: Android 15 no longer ships the
      // `android.app.action.REMOVE_DEVICE_ADMIN` activity, so asking the
      // system to open it silently does nothing.
      val removed =
        runCatching {
            val manager =
              reactApplicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE)
                as DevicePolicyManager
            manager.removeActiveAdmin(adminComponent(reactApplicationContext))
          }
          .isSuccess
      result.putBoolean("revoked", removed)
      result.putBoolean("launched", false)
      result.putBoolean("needsUserAction", false)
      promise.resolve(result)
      return
    }
    // Everything else has no programmatic revoke path; send the user there.
    val launched = runCatching { openSettingsSync(reactApplicationContext, key) }.getOrDefault(false)
    result.putBoolean("revoked", false)
    result.putBoolean("launched", launched)
    result.putBoolean("needsUserAction", true)
    promise.resolve(result)
  }

  companion object {
    /**
     * Snapshot 的纯数据版本：常驻服务用它在没有 JS 时回答
     * `permissions.snapshot`，返回顺序与设置页一致。
     */
    internal fun snapshot(context: Context): List<Pair<String, Boolean>> =
      KEYS.map { key -> key to isGranted(context, key) }

    internal fun isGranted(context: Context, key: String): Boolean =
      when (key) {
        KEY_DEVICE_ADMIN -> deviceAdminActive(context)
        KEY_ACCESSIBILITY -> accessibilityEnabled(context)
        KEY_USAGE_ACCESS -> usageAccessGranted(context)
        KEY_OVERLAY -> Settings.canDrawOverlays(context)
        KEY_BATTERY_UNRESTRICTED -> batteryUnrestricted(context)
        KEY_NOTIFICATION_LISTENER -> notificationListenerEnabled(context)
        KEY_EXACT_ALARM -> exactAlarmAllowed(context)
        KEY_LOCATION -> locationGranted(context)
        KEY_PHOTO_SHARE -> photoShareGranted(context)
        KEY_SCREEN_CAPTURE_STANDING -> ScreenshotModule.standingReady(context)
        else -> false
      }

    private fun adminComponent(context: Context): ComponentName =
      ComponentName(context, QiDeviceAdminReceiver::class.java)

    private fun deviceAdminActive(context: Context): Boolean =
      runCatching {
          val manager =
            context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
          manager.isAdminActive(adminComponent(context))
        }
        .getOrDefault(false)

    /**
     * Reads the system's enabled-services list and answers "is *this package*
     * among them". We do not declare an AccessibilityService on purpose (it would
     * mean broad input access we refuse to hold), so today this reports false;
     * the parser stays correct the moment a narrow service ships.
     */
    private fun accessibilityEnabled(context: Context): Boolean {
      val enabled =
        Settings.Secure.getString(
          context.contentResolver,
          Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
      val masterOn =
        Settings.Secure.getInt(
          context.contentResolver,
          Settings.Secure.ACCESSIBILITY_ENABLED,
          0
        ) == 1
      if (!masterOn) return false
      val prefix = context.packageName + "/"
      return enabled.split(':').any { it.startsWith(prefix) }
    }

    private fun usageAccessGranted(context: Context): Boolean =
      runCatching {
          val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
          // unsafeCheckOpNoThrow is the API 29+ replacement for checkOpNoThrow;
          // minSdk is 29 so no legacy branch is needed. MODE_DEFAULT means "never
          // asked", which must read as not granted.
          appOps.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.packageName
          ) == AppOpsManager.MODE_ALLOWED
        }
        .getOrDefault(false)

    private fun batteryUnrestricted(context: Context): Boolean =
      runCatching {
          val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
          power.isIgnoringBatteryOptimizations(context.packageName)
        }
        .getOrDefault(false)

    private fun notificationListenerEnabled(context: Context): Boolean =
      runCatching {
          NotificationManagerCompat.getEnabledListenerPackages(context)
            .contains(context.packageName)
        }
        .getOrDefault(false)

    /** Before API 31 exact alarms needed no permission at all. */
    private fun exactAlarmAllowed(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
      return runCatching {
          val alarm = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
          alarm.canScheduleExactAlarms()
        }
        .getOrDefault(false)
    }

    private fun locationGranted(context: Context): Boolean {
      val fine =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) ==
          PackageManager.PERMISSION_GRANTED
      val coarse =
        ContextCompat.checkSelfPermission(
          context,
          android.Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
      return fine || coarse
    }

    /**
     * Android 14 added "select photos" (partial access); that still counts as a
     * usable photo permission for the picker, so it is accepted here.
     */
    private fun photoShareGranted(context: Context): Boolean {
      fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) ==
          PackageManager.PERMISSION_GRANTED

      return when {
        Build.VERSION.SDK_INT >= 34 ->
          granted("android.permission.READ_MEDIA_IMAGES") ||
            granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
        Build.VERSION.SDK_INT >= 33 -> granted("android.permission.READ_MEDIA_IMAGES")
        else -> granted(android.Manifest.permission.READ_EXTERNAL_STORAGE)
      }
    }

    private fun settingsIntent(context: Context, key: String): Intent? {
      val packageUri = Uri.fromParts("package", context.packageName, null)
      return when (key) {
        KEY_DEVICE_ADMIN ->
          Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
            .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent(context))
            .putExtra(
              DevicePolicyManager.EXTRA_ADD_EXPLANATION,
              "允许祈在你同意时锁定屏幕（仅此一项）"
            )
        KEY_ACCESSIBILITY -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        KEY_USAGE_ACCESS -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        KEY_OVERLAY ->
          Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).setData(packageUri)
        // REQUEST_IGNORE_BATTERY_OPTIMIZATIONS shows the one-tap exemption dialog;
        // the generic settings page is the fallback for ROMs that hide it.
        KEY_BATTERY_UNRESTRICTED ->
          Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).setData(packageUri)
        KEY_NOTIFICATION_LISTENER ->
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          } else {
            Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
          }
        KEY_EXACT_ALARM ->
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).setData(packageUri)
          } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(packageUri)
          }
        // Runtime permissions cannot be granted from Settings directly; the app
        // details page is where the user turns them on after a denial.
        KEY_LOCATION, KEY_PHOTO_SHARE ->
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(packageUri)
        // Screen capture consent is a MediaProjection dialog, never a settings
        // toggle: JS must call ScreenshotModule.requestPermission() instead.
        KEY_SCREEN_CAPTURE_STANDING -> null
        else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(packageUri)
      }
    }

    private fun openSettingsSync(context: Context, key: String): Boolean {
      val intent = settingsIntent(context, key) ?: return false
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      return true
    }

    /** Keys are the contract with `QiDevice.ts`; order drives the settings list. */
    private val KEYS =
      listOf(
        KEY_DEVICE_ADMIN,
        KEY_ACCESSIBILITY,
        KEY_USAGE_ACCESS,
        KEY_OVERLAY,
        KEY_BATTERY_UNRESTRICTED,
        KEY_NOTIFICATION_LISTENER,
        KEY_EXACT_ALARM,
        KEY_LOCATION,
        KEY_PHOTO_SHARE,
        KEY_SCREEN_CAPTURE_STANDING
      )

    const val KEY_DEVICE_ADMIN = "deviceAdmin"
    const val KEY_ACCESSIBILITY = "accessibility"
    const val KEY_USAGE_ACCESS = "usageAccess"
    const val KEY_OVERLAY = "overlay"
    const val KEY_BATTERY_UNRESTRICTED = "batteryUnrestricted"
    const val KEY_NOTIFICATION_LISTENER = "notificationListener"
    const val KEY_EXACT_ALARM = "exactAlarm"
    const val KEY_LOCATION = "location"
    const val KEY_PHOTO_SHARE = "photoShare"
    const val KEY_SCREEN_CAPTURE_STANDING = "screenCaptureStanding"
  }
}
