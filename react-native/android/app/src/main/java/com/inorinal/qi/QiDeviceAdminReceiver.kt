package com.inorinal.qi

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.ComponentName

/**
 * Device-admin surface, intentionally minimal.
 *
 * We request exactly one policy (force-lock) so the app can offer "lock the
 * screen now" after the 小狗 explicitly asked the 主人 to do it. Remote wipe,
 * silent install, password policy and keyguard reset are deliberately NOT
 * implemented — the receiver exists only to satisfy Android's requirement that
 * a force-lock request be backed by an active admin component.
 */
class QiDeviceAdminReceiver : DeviceAdminReceiver() {
  companion object {
    fun component(context: Context): ComponentName =
      ComponentName(context, QiDeviceAdminReceiver::class.java)
  }
}
