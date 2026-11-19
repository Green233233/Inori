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
      NoticeModule(reactContext),
      // 小狗端常驻「联动」通道：App 不在前台时也能收到新任务/券（见 QiLinkService）。
      LinkServiceModule(reactContext),
      // 应用限制：主人下发名单，小狗端前台检测 + 全屏拦截（见 AppLimitWatcher）。
      AppLimitModule(reactContext)
    )

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
