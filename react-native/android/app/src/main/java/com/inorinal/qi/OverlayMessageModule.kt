package com.inorinal.qi

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Full-screen overlay message.
 *
 * Why native instead of an in-app modal: the point of this component is to
 * reach the user while they are *not* in 祈 (e.g. a 30 s "回来看看我" note from
 * the 主人). That requires SYSTEM_ALERT_WINDOW, so every rule here is designed
 * to make the overlay impossible to abuse:
 *
 *  - the 小狗 can always dismiss it with the visible "好了，我知道了" button
 *    (and the overlay never steals the back button);
 *  - it disappears automatically after at most 30 s, no matter what JS asks;
 *  - no animation at all: it is an interruption, not a show;
 *  - it covers only the app's own window, not other apps' touch handling, and
 *    it is removed the moment the module is invalidated.
 */
class OverlayMessageModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val main = Handler(Looper.getMainLooper())
  private var overlay: View? = null
  private var dismissTask: Runnable? = null

  override fun getName(): String = "QiOverlay"

  @ReactMethod
  fun show(message: String, timeoutMs: Int, promise: Promise) {
    val context = reactApplicationContext
    if (!Settings.canDrawOverlays(context)) {
      promise.reject("overlay_denied", "请先在设置里允许「显示在其他应用上层」")
      return
    }
    if (message.isBlank()) {
      promise.reject("overlay_empty", "消息不能为空")
      return
    }
    // 30 s cap is a hard product rule, not a default: an overlay that can be
    // made persistent by a buggy caller becomes spyware-like very quickly.
    val duration = timeoutMs.coerceIn(MIN_DURATION_MS, MAX_DURATION_MS).toLong()
    main.post {
      try {
        removeOverlay()
        val view = buildView(message)
        val params =
          WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
              WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
              WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
          )
            .apply {
              gravity = Gravity.TOP or Gravity.START
              x = 0
              y = 0
            }
        windowManager().addView(view, params)
        overlay = view
        scheduleDismiss(duration)
        promise.resolve(true)
      } catch (error: Exception) {
        removeOverlay()
        promise.reject("overlay_failed", error.message, error)
      }
    }
  }

  @ReactMethod
  fun hide(promise: Promise) {
    main.post {
      removeOverlay()
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val map = Arguments.createMap()
    map.putBoolean("visible", overlay != null)
    map.putBoolean("canDrawOverlays", Settings.canDrawOverlays(reactApplicationContext))
    map.putInt("maxDurationMs", MAX_DURATION_MS)
    promise.resolve(map)
  }

  override fun invalidate() {
    main.post { removeOverlay() }
    super.invalidate()
  }

  // ---------------------------------------------------------------- internals

  private fun buildView(message: String): View {
    val context = reactApplicationContext
    val density = context.resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()

    val root =
      LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        // Opaque enough to be unmistakably an interruption, soft enough to read.
        setBackgroundColor(Color.argb(0xF2, 0x14, 0x12, 0x1A))
        setPadding(dp(28), dp(48), dp(28), dp(48))
      }

    val title =
      TextView(context).apply {
        text = "祈"
        textSize = 14f
        setTextColor(Color.parseColor("#C9B8E0"))
        letterSpacing = 0.4f
        gravity = Gravity.CENTER
      }
    val body =
      TextView(context).apply {
        text = message
        textSize = 24f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        setLineSpacing(dp(6).toFloat(), 1.2f)
        setPadding(0, dp(20), 0, dp(32))
      }
    val close =
      Button(context).apply {
        text = "好了，我知道了"
        // The 小狗 must always be able to make it stop; this is the single
        // affordance the overlay exists for.
        contentDescription = "关闭这条消息"
        minimumHeight = dp(48)
        setOnClickListener { removeOverlay() }
      }

    root.addView(title)
    root.addView(body)
    root.addView(close)
    return root
  }

  private fun scheduleDismiss(durationMs: Long) {
    val task = Runnable { removeOverlay() }
    dismissTask = task
    main.postDelayed(task, durationMs)
  }

  private fun removeOverlay() {
    dismissTask?.let { task -> main.removeCallbacks(task) }
    dismissTask = null
    val view = overlay ?: return
    overlay = null
    runCatching { windowManager().removeView(view) }
  }

  private fun windowManager(): WindowManager =
    reactApplicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  companion object {
    private const val MIN_DURATION_MS = 1_000
    private const val MAX_DURATION_MS = 30_000
  }
}
