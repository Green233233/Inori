package com.inorinal.qi

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Registers the 祈 pairing/transport modules (device-control modules join here). */
class QiPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(
      CryptoModule(reactContext),
      SecureStoreModule(reactContext),
      ApiClientModule(reactContext),
      // Device capabilities. Every one of these is described in QiDevice.ts and
      // gated by the permission center (QiDevicePermissions).
      PermissionCenterModule(reactContext),
      GuardModule(reactContext),
      UsageStatsModule(reactContext),
      ScreenshotModule(reactContext),
      LocationModule(reactContext),
      NotificationRelayModule(reactContext),
      OverlayMessageModule(reactContext),
      AuditLogModule(reactContext),
      WidgetModule(reactContext),
      ReminderModule(reactContext),
      NoticeModule(reactContext)
    )

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
