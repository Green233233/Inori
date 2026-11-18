package com.inorinal.qi

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.inorinal.R

/**
 * Home-screen widget: shows the current pairing state.
 *
 * The widget never talks to the network itself — JS pushes the latest summary
 * when it already has one, so the widget cannot keep a radio awake.
 */
class QiWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val title = prefs.getString(KEY_TITLE, "祈") ?: "祈"
    val body = prefs.getString(KEY_BODY, "打开祈完成联结") ?: "打开祈完成联结"
    appWidgetIds.forEach { id ->
      val views = RemoteViews(context.packageName, R.layout.qi_widget)
      views.setTextViewText(R.id.qi_widget_title, title)
      views.setTextViewText(R.id.qi_widget_body, body)
      appWidgetManager.updateAppWidget(id, views)
    }
  }

  companion object {
    const val PREFS = "qi.widget"
    const val KEY_TITLE = "title"
    const val KEY_BODY = "body"
  }
}

class WidgetModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "QiWidget"

  @ReactMethod
  fun update(title: String, body: String, promise: Promise) {
    try {
      val context = reactApplicationContext
      context.getSharedPreferences(QiWidgetProvider.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(QiWidgetProvider.KEY_TITLE, title)
        .putString(QiWidgetProvider.KEY_BODY, body)
        .apply()
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        ComponentName(context, QiWidgetProvider::class.java),
      )
      if (ids.isNotEmpty()) {
        QiWidgetProvider().onUpdate(context, manager, ids)
      }
      promise.resolve(ids.size)
    } catch (error: Exception) {
      promise.reject("widget_update_failed", error.message, error)
    }
  }
}
