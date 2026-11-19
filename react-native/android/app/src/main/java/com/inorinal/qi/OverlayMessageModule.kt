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

    /**
     * 常驻拦截提示（主人禁止小狗使用的应用）。
     *
     * 与 [show] 的区别是硬性的：这里没有超时，只有用户点「我知道了」、调用
     * [hideBlocked] 或模块销毁才移除。参数 `label` 是被禁应用名（解析不到时是
     * 包名），它只用于展示。
     */
    @ReactMethod
    fun showBlocked(label: String, promise: Promise) {
      val context = reactApplicationContext
      if (!Settings.canDrawOverlays(context)) {
        promise.reject("overlay_denied", "请先在设置里允许「显示在其他应用上层」")
        return
      }
      val display = label.trim().ifBlank { "这个应用" }
      BlockedOverlay.show(context, "", display)
      promise.resolve(true)
    }

    @ReactMethod
    fun hideBlocked(promise: Promise) {
      BlockedOverlay.hide()
      promise.resolve(true)
    }

  override fun invalidate() {
    main.post { removeOverlay() }
    // The blocked overlay outlives JS by design; a destroyed module must not
    // leave a full-screen window behind with no one able to dismiss it.
    BlockedOverlay.hide()
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

/**
 * The persistent "this app is blocked by 主人" cover.
 *
 * Deliberately separate from [OverlayMessageModule.overlay]: the message overlay
 * is a transient note with a hard 30 s cap, this one is a state that stays until
 * the foreground app changes or the 小狗 dismisses it. Keeping them apart means
 * neither feature can accidentally inherit the other's lifetime rules.
 *
 * Window flags are the same as the message overlay (`FLAG_NOT_FOCUSABLE` +
 * `LAYOUT_IN_SCREEN|LAYOUT_NO_LIMITS`): not focusable keeps the back key and the
 * IME with the app underneath, while touches still reach the button — only
 * `FLAG_NOT_TOUCHABLE` would block the button. The root view is clickable with an
 * empty listener so taps outside the card are swallowed instead of reaching the
 * blocked app; no other gesture is intercepted.
 */
internal object BlockedOverlay {
    private const val TAG = "QiLimits"

    private val main = Handler(Looper.getMainLooper())

    private var overlayView: View? = null

    /** Package currently covered; `""` when shown from JS without a package. */
    @Volatile private var showingPkg: String? = null

    /** Package the user dismissed with 「我知道了」; cleared once it leaves. */
    @Volatile private var dismissedPkg: String? = null

    /** Returns false only when the overlay permission is missing. */
    fun show(context: Context, pkg: String, label: String): Boolean {
        if (!Settings.canDrawOverlays(context)) return false
        val app = context.applicationContext
        main.post {
            try {
                if (overlayView != null && showingPkg == pkg) return@post
                removeView()
                val view = buildView(app, pkg, label)
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
                windowManager(app).addView(view, params)
                overlayView = view
                showingPkg = pkg
            } catch (error: Exception) {
                Log.w(TAG, "展示拦截浮层失败", error)
                removeView()
            }
        }
        return true
    }

    fun hide() {
        main.post { removeView() }
    }

    fun isDismissedFor(pkg: String): Boolean = dismissedPkg == pkg

    /** 小狗已经离开那个应用，下一次进入必须再次拦截。 */
    fun clearDismissedIfLeft(foreground: String) {
        val dismissed = dismissedPkg
        if (dismissed != null && dismissed != foreground) {
            dismissedPkg = null
        }
    }

    // ---------------------------------------------------------------- internals

    private fun removeView() {
        val view = overlayView ?: return
        overlayView = null
        showingPkg = null
        runCatching { windowManager(view.context).removeView(view) }
    }

    private fun buildView(context: Context, pkg: String, label: String): View {
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root =
            LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setBackgroundColor(Color.argb(0xFA, 0x05, 0x05, 0x07))
                setPadding(dp(24), dp(32), dp(24), dp(32))
                isClickable = true
                // Consume taps that land on the backdrop so the blocked app underneath
                // cannot be operated while the cover is up.
                setOnClickListener {
                    // intentionally empty
                }
            }

        val card =
            LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                background =
                    GradientDrawable().apply {
                        setColor(Color.parseColor("#121216"))
                        cornerRadius = dp(20).toFloat()
                        setStroke(dp(1), Color.parseColor("#3A3A42"))
                    }
                setPadding(dp(24), dp(26), dp(24), dp(24))
                layoutParams =
                    LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    )
            }

        val appLabel =
            TextView(context).apply {
                text = label
                textSize = 13f
                setTextColor(Color.parseColor("#C9B8E0"))
                gravity = Gravity.CENTER
                letterSpacing = 0.04f
            }
        val title =
            TextView(context).apply {
                text = "主人已禁止小狗使用该应用"
                textSize = 22f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                setLineSpacing(dp(4).toFloat(), 1.15f)
                setPadding(0, dp(12), 0, dp(12))
            }
        val body =
            TextView(context).apply {
                text = "小狗可以随时在「我的 → 权限管控中心」关掉这条限制。"
                textSize = 14f
                setTextColor(Color.parseColor("#A1A1AA"))
                gravity = Gravity.CENTER
                setLineSpacing(dp(3).toFloat(), 1.3f)
            }
        val dismiss =
            Button(context).apply {
                text = "我知道了"
                contentDescription = "关闭本次拦截提示"
                textSize = 15f
                setTextColor(Color.WHITE)
                isAllCaps = false
                minimumHeight = dp(48)
                stateListAnimator = null
                background =
                    GradientDrawable().apply {
                        setColor(Color.parseColor("#FF2D55"))
                        cornerRadius = dp(14).toFloat()
                    }
                setOnClickListener {
                    dismissedPkg = pkg
                    removeView()
                }
            }

        card.addView(appLabel)
        card.addView(title)
        card.addView(body)
        card.addView(
            dismiss,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(48)
            )
                .apply { topMargin = dp(24) }
        )
        root.addView(card)
        return root
    }

    private fun windowManager(context: Context): WindowManager =
        context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
}
