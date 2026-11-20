package com.inorinal.qi

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.inorinal.R

/**
 * 双向事件通知（任务、和好券、定时规则…）。
 *
 * 设计取舍：
 *  - 只有一个高优先级渠道 "qi.notice"，重要但不吵：默认响一次、可下拉、不循环；
 *  - `fullscreen=true` 时附带全屏 Intent（`USE_FULL_SCREEN_INTENT`），由系统决定
 *    是否真的全屏展示（锁屏/免打扰下会被降级为 heads-up，这是系统行为，不是 bug）；
 *  - 每条通知用调用方给的 id 去重，重复到达只会更新同一条，不会堆成一列；
 *  - 没有任何定时器、没有前台服务：只在真有事的时候发一条。
 */
object NoticeCenter {
  // v2：祈发出的通知一律静音（用户要求「不响铃声，避免打扰」）。
  // 渠道一旦创建就无法改声音，所以换新 id 让系统按静音设置重新建。
  const val CHANNEL = "qi.notice.v2"
  private const val GROUP = "qi.notice.group"

  fun channel(context: Context): String {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(CHANNEL, "祈 · 消息", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "任务、和好券与定时规则的通知（静音，不响铃不振动）"
        enableLights(true)
        lightColor = Color.parseColor("#FF5C8A")
        enableVibration(false)
        setSound(null, null)
        setShowBadge(true)
      }
      manager.createNotificationChannel(channel)
    }
    return CHANNEL
  }

  fun post(context: Context, id: String, title: String, body: String, fullscreen: Boolean) {
    val channel = channel(context)
    val open = Intent(context, Class.forName("com.inorinal.MainActivity")).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra("qi.notice.id", id)
    }
    val content = PendingIntent.getActivity(
      context,
      id.hashCode(),
      open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setContentIntent(content)
      .setGroup(GROUP)
      .setCategory(if (fullscreen) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(if (fullscreen) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_DEFAULT)
      .setSilent(true)
    if (fullscreen) {
      // 系统可能在免打扰/锁屏策略下降级成 heads-up；这里不做任何绕过。
      builder.setFullScreenIntent(content, true)
    }
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .notify(id.hashCode(), builder.build())
  }

  fun cancel(context: Context, id: String) {
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .cancel(id.hashCode())
  }
}

class NoticeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "QiNotice"

  @ReactMethod
  fun post(id: String, title: String, body: String, fullscreen: Boolean, promise: Promise) {
    if (id.isBlank() || title.isBlank()) {
      promise.reject("notice_invalid", "通知内容为空")
      return
    }
    try {
      NoticeCenter.post(reactApplicationContext, id, title, body, fullscreen)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("notice_failed", error.message, error)
    }
  }

  @ReactMethod
  fun cancel(id: String, promise: Promise) {
    try {
      NoticeCenter.cancel(reactApplicationContext, id)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("notice_cancel_failed", error.message, error)
    }
  }
}
