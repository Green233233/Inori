package com.inorinal.qi

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.inorinal.R
import java.util.Calendar

/**
 * Daily reminders ("定时规则").
 *
 * Scheduling is done with AlarmManager (exact when the user granted the
 * permission, inexact otherwise) and each alarm only posts one notification —
 * no background service, no wake lock. Rules are re-registered after boot via
 * [ReminderScheduler.rescheduleAll].
 */
object ReminderScheduler {
  private const val PREFS = "qi.reminders"
  private const val CHANNEL = "qi.reminder"

  fun schedule(
    context: Context,
    id: String,
    hour: Int,
    minute: Int,
    daysCsv: String,
    message: String,
  ) {
    val days = daysCsv.split(",").mapNotNull { it.trim().toIntOrNull() }.toSet()
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit()
      .putString("$id.hour", hour.toString())
      .putString("$id.minute", minute.toString())
      .putString("$id.days", daysCsv)
      .putString("$id.message", message)
      .apply()
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pending = pendingIntent(context, id, message, PendingIntent.FLAG_UPDATE_CURRENT)
      ?: return
    val next = nextTrigger(hour, minute, days)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.canScheduleExactAlarms()) {
      manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
    } else {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
    }
  }

  fun cancel(context: Context, id: String) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pending = pendingIntent(context, id, null, PendingIntent.FLAG_NO_CREATE)
    if (pending != null) {
      manager.cancel(pending)
      pending.cancel()
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove("$id.hour").remove("$id.minute").remove("$id.days").remove("$id.message")
      .apply()
  }

  /** Re-arm every stored rule (called after boot or app update). */
  fun rescheduleAll(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val ids = prefs.all.keys.mapNotNull { key ->
      if (key.endsWith(".message")) key.removeSuffix(".message") else null
    }
    ids.forEach { id ->
      val hour = prefs.getString("$id.hour", null)?.toIntOrNull() ?: return@forEach
      val minute = prefs.getString("$id.minute", null)?.toIntOrNull() ?: return@forEach
      val days = prefs.getString("$id.days", "") ?: ""
      val message = prefs.getString("$id.message", "") ?: ""
      schedule(context, id, hour, minute, days, message)
    }
  }

  private fun nextTrigger(hour: Int, minute: Int, days: Set<Int>): Long {
    val now = Calendar.getInstance()
    val target = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    if (target.timeInMillis <= now.timeInMillis) {
      target.add(Calendar.DAY_OF_YEAR, 1)
    }
    if (days.isNotEmpty()) {
      var guard = 0
      while (!days.contains(target.get(Calendar.DAY_OF_WEEK) - 1) && guard < 8) {
        target.add(Calendar.DAY_OF_YEAR, 1)
        guard += 1
      }
    }
    return target.timeInMillis
  }

  private fun pendingIntent(
    context: Context,
    id: String,
    message: String?,
    flags: Int,
  ): PendingIntent? {
    val intent = Intent(context, ReminderReceiver::class.java).apply {
      action = "com.inorinal.REMINDER"
      putExtra("id", id)
      if (message != null) {
        putExtra("message", message)
      }
    }
    return PendingIntent.getBroadcast(
      context,
      id.hashCode(),
      intent,
      flags or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  fun channel(context: Context): String {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, "定时提醒", NotificationManager.IMPORTANCE_DEFAULT),
    )
    return CHANNEL
  }
}

/** Fires one notification and re-arms itself for the next matching day. */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: return
    val message = intent.getStringExtra("message") ?: "到时间啦"
    val channel = ReminderScheduler.channel(context)
    val open = Intent(context, Class.forName("com.inorinal.MainActivity")).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val content = PendingIntent.getActivity(
      context,
      id.hashCode(),
      open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(context, channel)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("祈 · 提醒")
      .setContentText(message)
      .setAutoCancel(true)
      .setContentIntent(content)
      .build()
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .notify(id.hashCode(), notification)
    // Re-arm for the next occurrence using the stored rule.
    val prefs = context.getSharedPreferences("qi.reminders", Context.MODE_PRIVATE)
    val hour = prefs.getString("$id.hour", null)?.toIntOrNull() ?: return
    val minute = prefs.getString("$id.minute", null)?.toIntOrNull() ?: return
    val days = prefs.getString("$id.days", "") ?: ""
    ReminderScheduler.schedule(context, id, hour, minute, days, message)
  }
}

class ReminderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "QiReminder"

  @ReactMethod
  fun schedule(
    id: String,
    hour: Int,
    minute: Int,
    daysCsv: String,
    message: String,
    promise: Promise,
  ) {
    try {
      ReminderScheduler.schedule(reactApplicationContext, id, hour, minute, daysCsv, message)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("reminder_schedule_failed", error.message, error)
    }
  }

  @ReactMethod
  fun cancel(id: String, promise: Promise) {
    try {
      ReminderScheduler.cancel(reactApplicationContext, id)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("reminder_cancel_failed", error.message, error)
    }
  }

  @ReactMethod
  fun rescheduleAll(promise: Promise) {
    try {
      ReminderScheduler.rescheduleAll(reactApplicationContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("reminder_reschedule_failed", error.message, error)
    }
  }
}
