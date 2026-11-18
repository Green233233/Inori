package com.inorinal.qi

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Parcel
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.min

/**
 * Screen capture, deliberately two-mode because Android changed the rules:
 *
 *  - API 29-33: one consent can be kept ("standing token"). The token is held
 *    by [PuppyGuardService] (mediaProjection foreground service) and each capture
 *    spins up an ImageReader + VirtualDisplay, grabs exactly one frame and
 *    releases both immediately. Nothing is streamed or recorded.
 *  - API 34+: the platform requires a fresh consent for every projection, so
 *    each capture asks the user again and the token is never persisted.
 *
 * Compliance is built into the capture path, not the UI: every capture posts a
 * high-priority notification ("主人刚刚查看了你的屏幕") *before* the frame is
 * grabbed and appends a hash-chained audit record. That ordering is intentional
 * — if the capture then fails, the user still sees that an attempt happened.
 * Hard caps: 3 captures per rolling hour, at most 30 s per capture, 720p JPEG
 * quality 70.
 */
class ScreenshotModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private val prefs by lazy {
    reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  }
  private val io = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "qi-capture").apply { isDaemon = true }
  }
  private val captureRunning = AtomicBoolean(false)

  @Volatile private var pendingCapture: Promise? = null
  @Volatile private var pendingPermission: Promise? = null
  @Volatile private var pendingConsent: Pair<Int, Intent>? = null

  override fun getName(): String = "QiScreenshot"

  override fun initialize() {
    super.initialize()
    reactApplicationContext.addActivityEventListener(this)
  }

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(this)
    pendingCapture?.let { promise -> runCatching { promise.reject("cancelled", "模块已销毁") } }
    pendingPermission?.let { promise -> runCatching { promise.reject("cancelled", "模块已销毁") } }
    pendingCapture = null
    pendingPermission = null
    captureRunning.set(false)
    super.invalidate()
  }

  // ------------------------------------------------------------- public API

  @ReactMethod
  fun requestPermission(promise: Promise) {
    val activity = getCurrentActivity()
    if (activity == null) {
      // Consent MUST come from a visible activity; a background request would
      // be silently dropped by the system.
      promise.reject("no_activity", "请先回到应用内再授权屏幕共享")
      return
    }
    if (pendingPermission != null || pendingCapture != null) {
      promise.reject("consent_busy", "上一次屏幕共享授权还没有结束")
      return
    }
    pendingPermission = promise
    launchConsent(activity)
  }

  @ReactMethod
  fun setStandingCapture(enabled: Boolean, promise: Promise) {
    val result = Arguments.createMap()
    result.putInt("apiLevel", Build.VERSION.SDK_INT)
    if (enabled && Build.VERSION.SDK_INT >= 34) {
      // Not a limitation we can work around: Android 14 revoked the "one
      // consent, many projections" model on purpose.
      prefs.edit().putBoolean(PREF_STANDING, false).apply()
      result.putBoolean("standing", false)
      result.putString(
        "note",
        "Android 14 起系统要求每次抓取单独确认，无法常驻授权"
      )
      promise.resolve(result)
      return
    }
    prefs.edit().putBoolean(PREF_STANDING, enabled).apply()
    if (!enabled) {
      clearToken()
      pendingConsent = null
      PuppyGuardService.endProjection(reactApplicationContext)
    }
    result.putBoolean("standing", enabled)
    result.putString(
      "note",
      when {
        enabled && Build.VERSION.SDK_INT < 34 && storedToken() == null ->
          "已开启常驻模式；还需完成一次屏幕共享授权"
        enabled -> "常驻授权已开启，抓取时不会再弹系统确认"
        else -> "已关闭常驻授权"
      }
    )
    promise.resolve(result)
  }

  @ReactMethod
  fun capture(promise: Promise) {
    if (Build.VERSION.SDK_INT < 29) {
      promise.reject("unsupported", "系统版本过低，无法抓屏")
      return
    }
    if (!captureRunning.compareAndSet(false, true)) {
      promise.reject("capture_busy", "上一次抓取还没完成")
      return
    }
    val usedBefore = pruneTimes()
    if (usedBefore >= LIMIT_PER_HOUR) {
      captureRunning.set(false)
      promise.reject("capture_rate_limited", "一小时内最多 3 次，请稍后再试")
      return
    }
    markUsed()

    // 1) A projection is already alive (standing mode on API 29-33).
    if (ProjectionBroker.isAttached()) {
      runCapture(promise, standing = isStanding())
      return
    }

    // 2) We already have a consent token (fresh consent or persisted standing).
    val token = pendingConsent ?: storedToken()
    if (token != null) {
      captureWithToken(promise, token.first, token.second)
      return
    }

    // 3) Need the system dialog. It requires a visible activity.
    val activity = getCurrentActivity()
    if (activity == null) {
      captureRunning.set(false)
      promise.reject("needs_consent", "请回到应用内完成一次屏幕共享授权")
      return
    }
    pendingCapture = promise
    launchConsent(activity)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val result = Arguments.createMap()
    val used = pruneTimes()
    result.putInt("apiLevel", Build.VERSION.SDK_INT)
    result.putBoolean("standingEnabled", isStanding())
    result.putBoolean("standingActive", ProjectionBroker.isAttached())
    result.putInt("usedThisHour", used)
    result.putInt("limitPerHour", LIMIT_PER_HOUR)
    result.putBoolean("hasConsent", ProjectionBroker.isAttached() || pendingConsent != null || storedToken() != null)
    // Let the UI grey out the button instead of letting the user trigger a
    // rejection they cannot act on.
    result.putBoolean("canCapture", used < LIMIT_PER_HOUR && (ProjectionBroker.isAttached() || pendingConsent != null || storedToken() != null || getCurrentActivity() != null))
    result.putBoolean("needsActivityForConsent", Build.VERSION.SDK_INT >= 34 || storedToken() == null)
    promise.resolve(result)
  }

  // ------------------------------------------------------------- consent flow

  private fun launchConsent(activity: Activity) {
    runOnUi {
      try {
        val manager =
          reactApplicationContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as
            MediaProjectionManager
        activity.startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CONSENT)
      } catch (error: Exception) {
        failPending("consent_failed", error.message ?: "无法打开屏幕共享授权")
      }
    }
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?
  ) {
    if (requestCode != REQUEST_CONSENT) return
    val granted = resultCode == Activity.RESULT_OK && data != null
    if (!granted) {
      failPending("consent_denied", "你取消了屏幕共享授权")
      return
    }
    val intent = data!!
    // Only a standing-mode user gets a persisted token; a one-off consent stays
    // in memory so the next capture asks again (that is what the user agreed to).
    if (Build.VERSION.SDK_INT < 34 && isStanding()) saveToken(resultCode, intent)
    pendingConsent = resultCode to intent

    val capture = pendingCapture
    pendingCapture = null
    if (capture != null) {
      captureWithToken(capture, resultCode, intent)
      return
    }
    val permission = pendingPermission
    pendingPermission = null
    if (permission != null) {
      val result = Arguments.createMap()
      result.putBoolean("granted", true)
      result.putInt("apiLevel", Build.VERSION.SDK_INT)
      result.putBoolean("standing", isStanding())
      permission.resolve(result)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun failPending(code: String, message: String) {
    pendingCapture?.let { promise -> runCatching { promise.reject(code, message) } }
    pendingPermission?.let { promise -> runCatching { promise.reject(code, message) } }
    pendingCapture = null
    pendingPermission = null
    pendingConsent = null
    captureRunning.set(false)
  }

  // ------------------------------------------------------------- capture path

  /**
   * Routes the consent token through [PuppyGuardService]: on Android 14+ the
   * mediaProjection foreground service type must already be active when the
   * token is consumed, and the service is the only component allowed to hold it.
   */
  private fun captureWithToken(promise: Promise, resultCode: Int, data: Intent) {
    val standing = isStanding()
    ProjectionBroker.clearError()
    try {
      PuppyGuardService.startProjection(reactApplicationContext, resultCode, data)
    } catch (error: Exception) {
      rejectCapture(promise, standing, "projection_failed", error.message ?: "无法启动屏幕共享")
      return
    }
    io.execute {
      val projection = ProjectionBroker.await(PROJECTION_ATTACH_TIMEOUT_MS)
      if (projection == null) {
        rejectCapture(
          promise,
          standing,
          "projection_failed",
          ProjectionBroker.lastError() ?: "屏幕共享授权超时"
        )
        return@execute
      }
      grabAndResolve(promise, projection, standing)
    }
  }

  /** Standing mode: the projection is already alive, just grab a frame. */
  private fun runCapture(promise: Promise, standing: Boolean) {
    val projection = ProjectionBroker.current()
    if (projection == null) {
      rejectCapture(promise, standing, "projection_lost", "屏幕共享已结束，请重新授权")
      return
    }
    io.execute { grabAndResolve(promise, projection, standing) }
  }

  private fun grabAndResolve(promise: Promise, projection: MediaProjection, standing: Boolean) {
    // Compliance first: the user must be able to see that a look happened even
    // if the grab itself fails a millisecond later.
    notifyOwnerLooked()
    AuditLogModule.write("screenshot", "single frame, standing=$standing", reactApplicationContext)

    var bitmap: Bitmap? = null
    var failure: String? = null
    try {
      bitmap = grabFrame(projection)
      if (bitmap == null) failure = "抓取超时（系统可能正在投屏或锁屏）"
    } catch (error: Exception) {
      failure = error.message ?: "抓取失败"
    }
    // Bind to a val so the null check below is a real smart cast.
    val frame = bitmap ?: run {
      rejectCapture(promise, standing, "capture_failed", failure ?: "抓取失败")
      return
    }

    val width = frame.width
    val height = frame.height
    val base64 =
      try {
        val output = ByteArrayOutputStream()
        frame.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
        B64.encode(output.toByteArray())
      } catch (error: Exception) {
        null
      } finally {
        frame.recycle()
      }
    if (base64 == null) {
      rejectCapture(promise, standing, "encode_failed", "图片编码失败")
      return
    }

    val result = Arguments.createMap()
    result.putBoolean("ok", true)
    result.putString("base64", base64)
    result.putInt("width", width)
    result.putInt("height", height)
    result.putInt("bytes", (base64.length * 3) / 4)
    result.putDouble("at", System.currentTimeMillis().toDouble())
    result.putBoolean("standing", standing)
    result.putInt("usedThisHour", pruneTimes())
    promise.resolve(result)
    afterCapture(standing)
  }

  /**
   * Compresses once (720p JPEG q70) so neither JS nor the disk ever sees a
   * full-resolution frame.
   */
  private fun grabFrame(projection: MediaProjection): Bitmap? {
    val metrics = reactApplicationContext.resources.displayMetrics
    val (width, height) = targetSize(screenWidth(), screenHeight())
    val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
    val latch = CountDownLatch(1)
    val frame = AtomicReference<Bitmap?>(null)
    val thread = HandlerThread("qi-capture-frame")
    thread.start()
    val handler = Handler(thread.looper)
    var display: VirtualDisplay? = null
    try {
      reader.setOnImageAvailableListener({ source ->
        val image: Image? = runCatching { source.acquireLatestImage() }.getOrNull()
        if (image != null) {
          try {
            frame.set(imageToBitmap(image))
          } catch (ignored: Exception) {
            // A malformed stride is not fatal: the latch still releases so the
            // caller reports a clean failure instead of hanging for 30 s.
          } finally {
            runCatching { image.close() }
          }
        }
        latch.countDown()
      }, handler)
      display =
        projection.createVirtualDisplay(
          "qi-capture",
          width,
          height,
          metrics.densityDpi,
          DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
          reader.surface,
          null,
          handler
        )
      if (!latch.await(FRAME_TIMEOUT_MS, TimeUnit.MILLISECONDS)) return null
      return frame.get()
    } finally {
      // Release immediately: a lingering VirtualDisplay keeps the screen-share
      // indicator (and GPU buffers) alive after the single frame.
      runCatching { display?.release() }
      runCatching { reader.close() }
      runCatching { thread.quitSafely() }
    }
  }

  private fun imageToBitmap(image: Image): Bitmap {
    val plane = image.planes[0]
    val buffer = plane.buffer
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    val rowPadding = rowStride - pixelStride * image.width
    val padded =
      Bitmap.createBitmap(
        image.width + rowPadding / pixelStride,
        image.height,
        Bitmap.Config.ARGB_8888
      )
    padded.copyPixelsFromBuffer(buffer)
    val cropped = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
    if (cropped !== padded) padded.recycle()
    return cropped
  }

  private fun targetSize(sourceWidth: Int, sourceHeight: Int): Pair<Int, Int> {
    if (sourceWidth <= 0 || sourceHeight <= 0) return 720 to 1280
    val scale = min(min(1280f / sourceWidth, 720f / sourceHeight), 1f)
    val width = ((sourceWidth * scale).toInt() / 2 * 2).coerceAtLeast(2)
    val height = ((sourceHeight * scale).toInt() / 2 * 2).coerceAtLeast(2)
    return width to height
  }

  private fun screenWidth(): Int =
    reactApplicationContext.resources.displayMetrics.widthPixels

  private fun screenHeight(): Int =
    reactApplicationContext.resources.displayMetrics.heightPixels

  /** Tears down a per-capture projection; standing mode keeps it for next time. */
  private fun afterCapture(standing: Boolean) {
    captureRunning.set(false)
    if (!standing) {
      pendingConsent = null
      PuppyGuardService.endProjection(reactApplicationContext)
    }
  }

  private fun rejectCapture(
    promise: Promise,
    standing: Boolean,
    code: String,
    message: String
  ) {
    captureRunning.set(false)
    promise.reject(code, message)
    if (!standing) {
      pendingConsent = null
      PuppyGuardService.endProjection(reactApplicationContext)
    }
  }

  // ------------------------------------------------------------- notification

  private fun notifyOwnerLooked() {
    try {
      val context = reactApplicationContext
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_CAPTURE) == null) {
        manager.createNotificationChannel(
          NotificationChannel(
            CHANNEL_CAPTURE,
            "祈 · 屏幕被查看提醒",
            NotificationManager.IMPORTANCE_HIGH
          ).apply {
            description = "每次屏幕被抓取时提醒你，不可关闭"
            enableVibration(true)
          }
        )
      }
      val now = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
      val notification =
        NotificationCompat.Builder(context, CHANNEL_CAPTURE)
          .setSmallIcon(android.R.drawable.ic_menu_view)
          .setContentTitle("主人刚刚查看了你的屏幕")
          .setContentText("$now · 本次查看已写入审计日志，可在设置里核对")
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setCategory(NotificationCompat.CATEGORY_EVENT)
          .setAutoCancel(true)
          .setContentIntent(openAppIntent())
          .build()
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID_CAPTURE, notification)
    } catch (ignored: Exception) {
      // Notifications can be blocked by the user; the audit log still records
      // the capture, so the evidence chain stays intact.
    }
  }

  private fun openAppIntent(): PendingIntent {
    val intent =
      Intent().apply {
        setClassName(reactApplicationContext.packageName, "com.inorinal.MainActivity")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
    return PendingIntent.getActivity(
      reactApplicationContext,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  // ------------------------------------------------------------- rate limiting

  /** Records an attempt and returns how many attempts exist in the last hour. */
  private fun markUsed(): Int {
    val now = System.currentTimeMillis()
    val kept = pruneTimesInternal(now) + now.toString()
    prefs.edit().putString(PREF_TIMES, kept.joinToString(",")).apply()
    return kept.size
  }

  private fun pruneTimes(): Int = pruneTimesInternal(System.currentTimeMillis()).size

  private fun pruneTimesInternal(now: Long): MutableList<String> {
    val raw = prefs.getString(PREF_TIMES, "") ?: ""
    val kept = mutableListOf<String>()
    raw.split(',').forEach { entry ->
      val stamp = entry.trim().toLongOrNull() ?: return@forEach
      if (now - stamp < HOUR_MS) kept.add(stamp.toString())
    }
    if (kept.joinToString(",") != raw) {
      prefs.edit().putString(PREF_TIMES, kept.joinToString(",")).apply()
    }
    return kept
  }

  private fun isStanding(): Boolean =
    Build.VERSION.SDK_INT < 34 && prefs.getBoolean(PREF_STANDING, false)

  // ------------------------------------------------------------------ tokens

  /**
   * Persisting a consent Intent is the only way to keep standing capture alive
   * across a process restart. `Parcel.marshall` is used instead of storing the
   * Intent in a static field so a guard-service restart (START_STICKY) does not
   * silently lose a permission the user already granted.
   */
  private fun saveToken(resultCode: Int, data: Intent) {
    runCatching {
        val parcel = Parcel.obtain()
        try {
          parcel.writeInt(resultCode)
          data.writeToParcel(parcel, 0)
          prefs.edit().putString(PREF_TOKEN, B64.encode(parcel.marshall())).apply()
        } finally {
          parcel.recycle()
        }
      }
      .onFailure {
        // Some OEMs reject marshalling an Intent with a binder; standing mode
        // then works for this process only and a restart asks again.
        prefs.edit().remove(PREF_TOKEN).apply()
      }
  }

  private fun storedToken(): Pair<Int, Intent>? {
    val encoded = prefs.getString(PREF_TOKEN, null) ?: return null
    return runCatching {
      val bytes = B64.decode(encoded)
      val parcel = Parcel.obtain()
      try {
        parcel.unmarshall(bytes, 0, bytes.size)
        parcel.setDataPosition(0)
        val resultCode = parcel.readInt()
        val data = Intent.CREATOR.createFromParcel(parcel)
        resultCode to data
      } finally {
        parcel.recycle()
      }
    }
      .getOrNull()
  }

  private fun clearToken() {
    prefs.edit().remove(PREF_TOKEN).apply()
  }

  // ---------------------------------------------------------------- utilities

  private fun runOnUi(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block()
    else Handler(Looper.getMainLooper()).post(block)
  }

  companion object {
    private const val PREFS = "qi.screenshot"
    private const val PREF_STANDING = "standingEnabled"
    private const val PREF_TOKEN = "standingToken"
    private const val PREF_TIMES = "captureTimes"

    private const val CHANNEL_CAPTURE = "qi.capture"
    private const val NOTIFICATION_ID_CAPTURE = 0x7102

    private const val REQUEST_CONSENT = 0x7110
    private const val HOUR_MS = 60L * 60L * 1000L
    private const val FRAME_TIMEOUT_MS = 25_000L
    private const val PROJECTION_ATTACH_TIMEOUT_MS = 10_000L
    private const val JPEG_QUALITY = 70
    const val LIMIT_PER_HOUR = 3

    /**
     * Permission-center hook: true only when a standing token really exists on
     * a platform that still allows it.
     */
    fun standingReady(context: Context): Boolean {
      if (Build.VERSION.SDK_INT >= 34) return false
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return prefs.getBoolean(PREF_STANDING, false) && prefs.getString(PREF_TOKEN, null) != null
    }
  }
}
