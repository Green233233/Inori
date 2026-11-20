package com.inorinal.qi

import android.content.Context
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * 本机加密的截屏记录仓库：`filesDir/qi/shots/<id>.enc`。
 *
 * 为什么需要它：以前 `screen.capture` 只在内存里过一遍 base64，弹窗一关就没了，
 * 用户想回头看「上次看到的是什么」没有任何入口。这里把每一帧都以端到端配对
 * 密钥加密落盘，解绑（或换了另一个人）之后配对密钥不复存在，文件就再也打不开
 * ——这正是产品要的语义，而不是「删了才算安全」。
 *
 * 文件格式（单个文件，没有旁挂 JSON，避免两个文件不同步）：
 *
 * ```
 * 0..7          magic "QISHOT1\n"
 * 8..11         大端 uint32：header 字节数
 * 12..12+n-1    header JSON {"id","at","w","h","b"}（UTF-8，明文）
 * 12+n..+11     GCM nonce（12 字节）
 * 之后          ciphertext || 16 字节 tag
 * ```
 *
 * `[0, 12+n)` 整段（magic + 长度 + header）作为 **AAD** 参与 GCM 认证，所以
 * header 里的时间/尺寸不是随手可改的：改一个字节，解密时直接 tag 校验失败。
 * header 保持明文只是为了 `list()` 能在没有密钥（已解绑）时仍列出条目并显示
 * 「打不开」，图片本身永远是密文。
 *
 * 密钥：`PairRelayCrypto.pairKey()`，与 relay 消息同一把：
 * ECDH(P-256) → HKDF-SHA256(salt = "qi/pair/<pairId>", info = "qi/msg/v1", 32B)
 * → AES-256-GCM。密钥缓存与派生都在 PairRelayCrypto 里，这里只借用。
 */
internal object ScreenshotStore {
  private const val TAG = "QiShotStore"

  private const val DIR = "qi/shots"
  private const val SUFFIX = ".enc"
  private const val TEMP_SUFFIX = ".tmp"
  private const val MAX_KEPT = 100
  private const val MAGIC = "QISHOT1\n"
  private const val MAGIC_BYTES = 8
  private const val NONCE_BYTES = 12
  private const val GCM_TAG_BITS = 128
  private const val MIN_FILE = MAGIC_BYTES + 4 + 2 + NONCE_BYTES + 16

  /** `qi.link` 里由 QiProvider / QiLinkService 写下的配对上下文（都不是秘密）。 */
  private const val LINK_PREFS = "qi.link"
  private const val PREF_PAIR_ID = "pair_id"
  private const val PREF_PEER_PUB = "peer_pub"

  private val idPattern = Regex("^[A-Za-z0-9_-]{8,80}$")
  private val lock = Any()

  /** 一条记录的元数据；`size` 是 JPEG 明文字节数（不是加密后的大小）。 */
  data class Shot(
    val id: String,
    val at: Long,
    val size: Int,
    val width: Int,
    val height: Int,
  )

  // ------------------------------------------------------------------ public

  /** 本机当前配对上下文：先看调用方显式传入，再退回 `qi.link` prefs。 */
  fun resolvePair(
    context: Context,
    pairId: String?,
    peerPublicB64: String?,
  ): Pair<String, String>? {
    val directId = pairId?.trim().orEmpty()
    val directPeer = peerPublicB64?.trim().orEmpty()
    if (directId.isNotEmpty() && directPeer.isNotEmpty()) {
      return directId to directPeer
    }
    val prefs = context.getSharedPreferences(LINK_PREFS, Context.MODE_PRIVATE)
    val storedId = prefs.getString(PREF_PAIR_ID, null)?.trim().orEmpty()
    val storedPeer = prefs.getString(PREF_PEER_PUB, null)?.trim().orEmpty()
    if (storedId.isNotEmpty() && storedPeer.isNotEmpty()) {
      return storedId to storedPeer
    }
    return null
  }

  /**
   * 截屏端（小狗端）自己留一份档：只在已经有配对上下文时写入，失败不影响截屏。
   */
  fun autoSave(context: Context, jpeg: ByteArray, at: Long, width: Int, height: Int): Shot? {
    val pair = resolvePair(context, null, null) ?: return null
    return try {
      save(context, jpeg, pair.first, pair.second, at, width, height)
    } catch (error: Exception) {
      Log.w(TAG, "auto-save skipped: " + PairRelayCrypto.describeFailure(error))
      null
    }
  }

  fun list(context: Context): List<Shot> =
    dir(context)
      .listFiles { file -> file.isFile && file.name.endsWith(SUFFIX) }
      ?.mapNotNull { file -> readHeader(file) }
      ?.sortedByDescending { shot -> shot.at }
      ?: emptyList()

  fun save(
    context: Context,
    jpeg: ByteArray,
    pairId: String,
    peerPublicB64: String,
    at: Long,
    width: Int,
    height: Int,
  ): Shot = synchronized(lock) {
    require(jpeg.isNotEmpty()) { "empty frame" }
    val id = newId(at)
    val headerJson = JSONObject()
      .put("id", id)
      .put("at", at)
      .put("w", width)
      .put("h", height)
      .put("b", jpeg.size)
      .toString()
      .toByteArray(Charsets.UTF_8)
    val aad = ByteArrayOutputStream().also { buffer ->
      DataOutputStream(buffer).use { out ->
        out.write(MAGIC.toByteArray(Charsets.US_ASCII))
        out.writeInt(headerJson.size)
        out.write(headerJson)
      }
    }.toByteArray()

    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, PairRelayCrypto.pairKey(context, pairId, peerPublicB64))
    val nonce = cipher.iv
    require(nonce.size == NONCE_BYTES) { "unexpected GCM nonce" }
    cipher.updateAAD(aad)
    val ciphertext = cipher.doFinal(jpeg)

    val folder = dir(context)
    val target = File(folder, "$id$SUFFIX")
    val temp = File(folder, "$id$TEMP_SUFFIX")
    try {
      FileOutputStream(temp).use { stream ->
        stream.write(aad)
        stream.write(nonce)
        stream.write(ciphertext)
        stream.flush()
        try {
          stream.fd.sync()
        } catch (ignored: IOException) {
          // 某些 ROM 的 FUSE 路径不支持 fsync，写到 rename 成功即算落盘。
        }
      }
      if (!temp.renameTo(target)) {
        throw IOException("rename failed")
      }
    } catch (error: Exception) {
      temp.delete()
      target.delete()
      throw error
    }

    prune(context)
    Shot(id, at, jpeg.size, width, height)
  }

  /** 解密一帧；密钥不存在或不匹配会抛 [javax.crypto.AEADBadTagException]。 */
  fun read(context: Context, id: String, pairId: String, peerPublicB64: String): ByteArray =
    synchronized(lock) {
      val file = file(context, id)
      if (!file.isFile) {
        throw IOException("record missing")
      }
      val raw = file.readBytes()
      if (raw.size < MIN_FILE) {
        throw IOException("record truncated")
      }
      val buffer = ByteBuffer.wrap(raw)
      val magic = ByteArray(MAGIC_BYTES)
      buffer.get(magic)
      if (String(magic, Charsets.US_ASCII) != MAGIC) {
        throw IOException("unknown record format")
      }
      val headerLength = buffer.int
      if (headerLength <= 0 || headerLength > raw.size - (MAGIC_BYTES + 4 + NONCE_BYTES + 16)) {
        throw IOException("bad header length")
      }
      val aadEnd = MAGIC_BYTES + 4 + headerLength
      val nonce = raw.copyOfRange(aadEnd, aadEnd + NONCE_BYTES)
      val ciphertext = raw.copyOfRange(aadEnd + NONCE_BYTES, raw.size)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
        Cipher.DECRYPT_MODE,
        PairRelayCrypto.pairKey(context, pairId, peerPublicB64),
        GCMParameterSpec(GCM_TAG_BITS, nonce),
      )
      cipher.updateAAD(raw, 0, aadEnd)
      cipher.doFinal(ciphertext)
    }

  fun remove(context: Context, id: String): Boolean = synchronized(lock) {
    val file = file(context, id)
    var removed = false
    if (file.isFile) {
      removed = file.delete()
    }
    File(dir(context), "$id$TEMP_SUFFIX").delete()
    removed
  }

  // ---------------------------------------------------------------- internals

  private fun dir(context: Context): File =
    File(context.filesDir, DIR).apply { if (!exists()) mkdirs() }

  private fun file(context: Context, id: String): File {
    require(idPattern.matches(id)) { "bad id" }
    return File(dir(context), "$id$SUFFIX")
  }

  private fun newId(at: Long): String {
    val random = SecureRandom()
    val bytes = ByteArray(4)
    random.nextBytes(bytes)
    val tail = bytes.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    return "shot-$at-$tail"
  }

  /** 只读明文 header；损坏/陌生格式返回 null，让调用方安静跳过。 */
  private fun readHeader(file: File): Shot? {
    val id = file.name.removeSuffix(SUFFIX)
    if (!idPattern.matches(id)) {
      return null
    }
    return try {
      RandomAccessFile(file, "r").use { handle ->
        val magic = ByteArray(MAGIC_BYTES)
        handle.readFully(magic)
        if (String(magic, Charsets.US_ASCII) != MAGIC) {
          return null
        }
        val headerLength = handle.readInt()
        if (headerLength <= 0 || headerLength > 4096) {
          return null
        }
        val header = ByteArray(headerLength)
        handle.readFully(header)
        val json = JSONObject(String(header, Charsets.UTF_8))
        Shot(
          id = id,
          at = json.optLong("at", 0L),
          size = json.optInt("b", 0),
          width = json.optInt("w", 0),
          height = json.optInt("h", 0),
        )
      }
    } catch (error: Exception) {
      Log.w(TAG, "skip unreadable record: " + PairRelayCrypto.describeFailure(error))
      null
    }
  }

  /** 只保留最新 [MAX_KEPT] 条；解绑后读不了的旧档也按时间正常淘汰。 */
  private fun prune(context: Context) {
    val folder = dir(context)
    folder.listFiles { file -> file.isFile && file.name.endsWith(TEMP_SUFFIX) }?.forEach { stale ->
      stale.delete()
    }
    val files = folder.listFiles { file -> file.isFile && file.name.endsWith(SUFFIX) }
      ?: return
    val parsed = files.mapNotNull { file -> readHeader(file)?.let { shot -> shot to file } }
    // 头都读不出来的文件是半截垃圾（正常写入是 tmp → rename 原子替换），顺手清掉。
    val known = parsed.map { entry -> entry.second }.toSet()
    files.forEach { file -> if (file !in known) file.delete() }
    if (parsed.size <= MAX_KEPT) {
      return
    }
    parsed
      .sortedByDescending { entry -> entry.first.at }
      .drop(MAX_KEPT)
      .forEach { entry -> entry.second.delete() }
  }
}
