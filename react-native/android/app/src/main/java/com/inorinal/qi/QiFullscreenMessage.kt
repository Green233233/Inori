package com.inorinal.qi

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 全屏消息的原生实现，给常驻服务用。
 *
 * 主人的一句话应该在小狗「没打开祈」的时候也能看到，所以它必须是悬浮窗
 * 而不是 in-app 弹窗。规则和 `OverlayMessageModule` 保持一致：
 *
 *  - 小狗永远可以点「好了，我知道了」自己关掉；
 *  - 最多 [MAX_DURATION_MS] 后自动消失，调用方无法要求更久；
 *  - 不抢返回键、不做动画，它是一次打断，不是一次演出。
 */
object QiFullscreenMessage {

  private const val TAG = "QiFullscreen"
  private const val MIN_DURATION_MS = 1_000
  private const val MAX_DURATION_MS = 30_000
  const val DEFAULT_DURATION_MS = 15_000

  private val main = Handler(Looper.getMainLooper())
  private var overlay: View? = null
  private var dismissTask: Runnable? = null
  private var manager: WindowManager? = null

  /** 返回是否真的弹出来了（没有悬浮窗权限时返回 false，让调用方回包说明原因）。 */
  fun show(context: Context, message: String, timeoutMs: Int): Boolean {
    if (message.isBlank()) return false
    if (!Settings.canDrawOverlays(context)) return false
    val duration = timeoutMs.coerceIn(MIN_DURATION_MS, MAX_DURATION_MS).toLong()
    main.post {
      try {
        removeOverlay()
        val view = buildView(context, message)
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
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        manager = wm
        wm.addView(view, params)
        overlay = view
        val task = Runnable { removeOverlay() }
        dismissTask = task
        main.postDelayed(task, duration)
      } catch (error: Exception) {
        Log.w(TAG, "show_failed ${error.javaClass.simpleName}")
      }
    }
    return true
  }

  fun hide() {
    main.post { removeOverlay() }
  }

  private fun removeOverlay() {
    dismissTask?.let { main.removeCallbacks(it) }
    dismissTask = null
    val view = overlay ?: return
    overlay = null
    runCatching { manager?.removeView(view) }
  }

  private fun buildView(context: Context, message: String): View {
    val container =
      LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.parseColor("#CC000000"))
        isClickable = true
      }
    val card =
      LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(context, 24), dp(context, 28), dp(context, 24), dp(context, 20))
        background =
          GradientDrawable().apply {
            cornerRadius = dp(context, 24).toFloat()
            setColor(Color.parseColor("#F5F5F7"))
          }
      }
    val title =
      TextView(context).apply {
        text = "主人想对你说"
        textSize = 13f
        setTextColor(Color.parseColor("#8A8A8E"))
        gravity = Gravity.CENTER
      }
    val body =
      TextView(context).apply {
        text = message
        textSize = 22f
        setTextColor(Color.parseColor("#111114"))
        gravity = Gravity.CENTER
        setPadding(0, dp(context, 12), 0, dp(context, 20))
      }
    val dismiss =
      Button(context).apply {
        text = "好了，我知道了"
        textSize = 15f
        setTextColor(Color.WHITE)
        background =
          GradientDrawable().apply {
            cornerRadius = dp(context, 18).toFloat()
            setColor(Color.parseColor("#FA2D48"))
          }
        setOnClickListener { removeOverlay() }
      }
    card.addView(title)
    card.addView(body)
    card.addView(dismiss)
    container.addView(card)
    return container
  }

  private fun dp(context: Context, value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()
}
