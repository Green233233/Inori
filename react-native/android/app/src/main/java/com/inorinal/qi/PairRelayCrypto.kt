package com.inorinal.qi

import android.content.Context
import android.util.Log
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/**
 * Relay envelope crypto for code that has no React bridge (QiLinkService).
 *
 * 这是 `src/crypto/Crypto.ts` + `CryptoModule.kt` 的原生镜像，wire 格式逐字节
 * 一致，因此 JS 与常驻服务可以互解：
 *
 *  - 身份：`qi.crypto` / `identity.device`（PKCS#8，经 [KeystoreBox] 包裹），
 *    绝不新建第二把设备密钥——否则主端解不开原生发出的回包。
 *  - 密钥：ECDH(P-256) → HKDF-SHA256(salt = "qi/pair/<pairId>" 的原始字节,
 *    info = "qi/msg/v1", 32 字节) → AES-256-GCM。
 *  - 信封：`{"n": base64(nonce), "c": base64(ciphertext||tag)}`，与
 *    `JSON.stringify({n, c})` 完全同形，所以可以直接塞进 relay 的
 *    `ciphertext` 字段。
 *
 * 明文是 JSON 的 UTF-8 字节：JS 侧 `encodeBase64(JSON.stringify(value))` 在
 * Kotlin 里等价于 `json.toByteArray(UTF_8)`，不需要再做一层 base64。
 */
internal object PairRelayCrypto {
  const val TAG = "QiRelayCrypto"

  private const val PREFS = "qi.crypto"
  private const val DEVICE_IDENTITY = "device"
  private const val HKDF_INFO = "qi/msg/v1"
  private const val KEY_BYTES = 32
  private const val GCM_TAG_BITS = 128

  private val lock = Any()
  private val keyCache = HashMap<String, SecretKey>()

  /** `base64("qi/pair/" + pairId)`，与 `Crypto.ts` 的 pairSalt 完全一致。 */
  fun pairSalt(pairId: String): String = B64.encode("qi/pair/$pairId".toByteArray())

  fun hasIdentity(context: Context): Boolean =
    prefs(context).getString("identity.$DEVICE_IDENTITY", null) != null

  /**
   * 把 JSON 明文封成信封 JSON 字符串；失败抛异常，调用方负责回错误包。
   */
  fun seal(context: Context, pairId: String, peerPublicB64: String, json: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, sharedKey(context, pairId, peerPublicB64))
    val nonce = cipher.iv
    val ciphertext = cipher.doFinal(json.toByteArray(Charsets.UTF_8))
    return JSONObject()
      .put("n", B64.encode(nonce))
      .put("c", B64.encode(ciphertext))
      .toString()
  }

  /**
   * 解开信封 JSON 字符串并返回 JSON 明文；失败抛异常（身份缺失、配对密钥
   * 不匹配、数据被篡改都会走到这里）。
   */
  fun open(context: Context, pairId: String, peerPublicB64: String, sealedJson: String): String {
    val envelope = JSONObject(sealedJson)
    val nonce = envelope.optString("n", "")
    val ciphertext = envelope.optString("c", "")
    require(nonce.isNotEmpty() && ciphertext.isNotEmpty()) { "relay envelope missing n/c" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      sharedKey(context, pairId, peerPublicB64),
      GCMParameterSpec(GCM_TAG_BITS, B64.decode(nonce))
    )
    val plain = cipher.doFinal(B64.decode(ciphertext))
    return String(plain, Charsets.UTF_8)
  }

  // ---------------------------------------------------------------- internals

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun sharedKey(context: Context, pairId: String, peerPublicB64: String): SecretKey {
    val saltB64 = pairSalt(pairId)
    val cacheKey = "$pairId|$peerPublicB64|$saltB64"
    synchronized(lock) { keyCache[cacheKey]?.let { return it } }

    val sealed = prefs(context).getString("identity.$DEVICE_IDENTITY", null)
      ?: throw IllegalStateException("device identity missing")
    val privateDer = KeystoreBox.open(sealed)
    val keyFactory = KeyFactory.getInstance("EC")
    val privateKey = keyFactory.generatePrivate(PKCS8EncodedKeySpec(privateDer))
    val peer = keyFactory.generatePublic(X509EncodedKeySpec(B64.decode(peerPublicB64)))
    val agreement = KeyAgreement.getInstance("ECDH")
    agreement.init(privateKey)
    agreement.doPhase(peer, true)
    val secret = agreement.generateSecret()
    val derived = hkdf(secret, B64.decode(saltB64), HKDF_INFO.toByteArray(Charsets.UTF_8), KEY_BYTES)
    val key = SecretKeySpec(derived, "AES")
    synchronized(lock) { keyCache[cacheKey] = key }
    return key
  }

  /** HKDF-SHA256（RFC 5869），与 CryptoModule.hkdf 相同实现。 */
  private fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(salt, "HmacSHA256"))
    val prk = mac.doFinal(ikm)
    mac.init(SecretKeySpec(prk, "HmacSHA256"))
    val output = ByteArray(length)
    var previous = ByteArray(0)
    var position = 0
    var counter = 1
    while (position < length) {
      mac.update(previous)
      mac.update(info)
      mac.update(counter.toByte())
      previous = mac.doFinal()
      val copy = minOf(previous.size, length - position)
      System.arraycopy(previous, 0, output, position, copy)
      position += copy
      counter += 1
    }
    return output
  }

  /** 仅用于诊断：把异常类型收敛成可日志的短标签（不含密钥/坐标/pairId）。 */
  fun describeFailure(error: Exception): String = error.javaClass.simpleName
}
