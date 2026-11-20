package com.inorinal.qi

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException

/**
 * 截屏记录（本机加密存档）的 JS 接口。
 *
 * 数据本身住在 [ScreenshotStore]：`filesDir/qi/shots/<id>.enc`，用配对的
 * ECDH/HKDF 密钥做 AES-256-GCM，明文 header（时间/尺寸）作为 AAD 一起认证。
 * 因此：
 *  - `list()` 不需要密钥（只读 header），解绑后仍能看到「有几条、什么时候的」；
 *  - `read()` 必须拿到当前配对密钥，解绑之后必然失败，返回明确的中文提示；
 *  - 换一个人重新配对，旧文件同样打不开——密钥按 pairId 派生，不会复用。
 *
 * `save()` 不是给截屏端用的（截屏端由 [ScreenshotModule] 自己落盘，走
 * `ScreenshotStore.autoSave` 那条带 prefs 回退的路径），而是给主人端：帧是端到端
 * 传过来的 base64，主人端也要能回头翻看，所以由 JS 把这一帧交给本机加密存档。
 *
 * `read()` / `save()` 都只认调用方显式给出的**当前**配对（pairId + 对方公钥）：
 * 这里刻意不回退磁盘上的 `qi.link` 旧上下文，否则解绑之后旧文件还能被同机解开，
 * 「解绑即失效」就不成立了。
 */
class ScreenshotGalleryModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val io: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "qi-shots").apply { isDaemon = true }
  }

  override fun getName(): String = "QiScreenshotGallery"

  override fun invalidate() {
    io.shutdownNow()
    super.invalidate()
  }

  @ReactMethod
  fun list(promise: Promise) {
    io.execute {
      try {
        val array = Arguments.createArray()
        ScreenshotStore.list(reactApplicationContext).forEach { shot ->
          array.pushMap(shot.toMap())
        }
        promise.resolve(array)
      } catch (error: Exception) {
        promise.reject("gallery_list_failed", "读取截屏记录失败：${reason(error)}")
      }
    }
  }

  /**
   * 返回 `data:image/jpeg;base64,...`。只有 GCM tag 校验通过才返回：
   * 解绑/换人后这里会稳定失败，前端据此显示「已锁定」而不是空白图。
   */
  @ReactMethod
  fun read(id: String, pairId: String?, peerPublicB64: String?, promise: Promise) {
    io.execute {
      val context = reactApplicationContext
      try {
        // 读图必须用「此刻的配对」：刻意不回退 qi.link prefs。解绑之后 JS 拿不到
        // pair，这里就会稳定拒绝——老文件即使还在磁盘上也打不开，这正是产品要的。
        val current = requirePair(pairId, peerPublicB64) ?: run {
          promise.reject("gallery_unpaired", "解绑之后，本机保存的截屏就打不开了")
          return@execute
        }
        val jpeg = ScreenshotStore.read(context, id, current.first, current.second)
        promise.resolve("data:image/jpeg;base64," + B64.encode(jpeg))
      } catch (error: Exception) {
        promise.reject(codeFor(error), messageFor(error))
      }
    }
  }

  /** 主人端把收到的帧交给本机加密存档；返回新记录的元数据。 */
  @ReactMethod
  fun save(
    base64: String,
    pairId: String?,
    peerPublicB64: String?,
    at: Double,
    width: Double,
    height: Double,
    promise: Promise,
  ) {
    io.execute {
      val context = reactApplicationContext
      try {
        val current = requirePair(pairId, peerPublicB64) ?: run {
          promise.reject("gallery_unpaired", "还没有配对，截屏存不下来")
          return@execute
        }
        val payload = base64.substringAfter(',', base64).trim()
        if (payload.isEmpty()) {
          promise.reject("gallery_bad_image", "这张截屏没有内容，存不下来")
          return@execute
        }
        val jpeg = B64.decode(payload)
        val stamp = if (at > 0) at.toLong() else System.currentTimeMillis()
        val shot = ScreenshotStore.save(
          context,
          jpeg,
          current.first,
          current.second,
          stamp,
          width.toInt().coerceAtLeast(0),
          height.toInt().coerceAtLeast(0),
        )
        promise.resolve(shot.toMap())
      } catch (error: Exception) {
        promise.reject("gallery_save_failed", "保存截屏失败：${reason(error)}")
      }
    }
  }

  @ReactMethod
  fun remove(id: String, promise: Promise) {
    io.execute {
      try {
        ScreenshotStore.remove(reactApplicationContext, id)
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("gallery_remove_failed", "删除截屏失败：${reason(error)}")
      }
    }
  }

  /** 只接受调用方显式给的当前配对，绝不从磁盘上的旧上下文里捞。 */
  private fun requirePair(
    pairId: String?,
    peerPublicB64: String?,
  ): Pair<String, String>? {
    val id = pairId?.trim().orEmpty()
    val peer = peerPublicB64?.trim().orEmpty()
    return if (id.isNotEmpty() && peer.isNotEmpty()) id to peer else null
  }

  private fun ScreenshotStore.Shot.toMap(): WritableMap =
    Arguments.createMap().apply {
      putString("id", id)
      putDouble("at", at.toDouble())
      putInt("size", size)
      putInt("width", width)
      putInt("height", height)
    }

  private fun codeFor(error: Exception): String = when {
    error is AEADBadTagException || error is BadPaddingException -> "gallery_locked"
    isMissing(error) -> "gallery_missing"
    error is IllegalArgumentException -> "gallery_bad_id"
    else -> "gallery_read_failed"
  }

  private fun messageFor(error: Exception): String = when {
    error is AEADBadTagException || error is BadPaddingException ->
      "解绑或换了配对之后，这条截屏已经无法解密"
    isMissing(error) -> "这条截屏记录已经不在了"
    error is IllegalArgumentException -> "这条截屏记录的编号不对"
    else -> "打开截屏失败：${reason(error)}"
  }

  /** 文件不在 / 被截断：store 抛的是 IOException("record missing") 这类短原因。 */
  private fun isMissing(error: Exception): Boolean =
    error is java.io.FileNotFoundException ||
      (error is java.io.IOException && error.message?.startsWith("record") == true)

  /** 只回类型名，绝不在错误里带回密钥、id 或路径。 */
  private fun reason(error: Exception): String =
    error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
}
