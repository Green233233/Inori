package com.inorinal.qi

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Pair-scoped hybrid crypto: ECDH (P-256) -> HKDF-SHA256 -> AES-256-GCM.
 *
 * Identity private keys are generated in software but stored sealed by
 * [KeystoreBox]; JS only ever receives ciphertext, nonces and public keys.
 * Everything runs on the native module queue, never on the UI thread.
 */
class CryptoModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val prefs =
    reactContext.getSharedPreferences("qi.crypto", Context.MODE_PRIVATE)
  private val random = SecureRandom()
  private val keyCache = HashMap<String, SecretKey>()
  private val lock = Any()

  override fun getName(): String = "QiCrypto"

  private fun identityKey(pairId: String) = "identity.$pairId"
  private fun publicKeyKey(pairId: String) = "public.$pairId"

  @ReactMethod
  fun createIdentity(pairId: String, promise: Promise) {
    try {
      val generator = KeyPairGenerator.getInstance("EC")
      generator.initialize(ECGenParameterSpec("secp256r1"), random)
      val pair = generator.generateKeyPair()
      val privateDer = pair.private.encoded
      val publicDer = pair.public.encoded
      prefs.edit()
        .putString(identityKey(pairId), KeystoreBox.seal(privateDer))
        .putString(publicKeyKey(pairId), B64.encode(publicDer))
        .apply()
      synchronized(lock) { keyCache.keys.removeAll { it.startsWith("$pairId|") } }
      promise.resolve(B64.encode(publicDer))
    } catch (error: Exception) {
      promise.reject("crypto_error", error.message, error)
    }
  }

  @ReactMethod
  fun identityPublicKey(pairId: String, promise: Promise) {
    promise.resolve(prefs.getString(publicKeyKey(pairId), null))
  }

  @ReactMethod
  fun deleteIdentity(pairId: String, promise: Promise) {
    prefs.edit()
      .remove(identityKey(pairId))
      .remove(publicKeyKey(pairId))
      .apply()
    synchronized(lock) { keyCache.keys.removeAll { it.startsWith("$pairId|") } }
    promise.resolve(true)
  }

  private fun sharedKey(pairId: String, peerPublicB64: String, saltB64: String): SecretKey {
    val cacheKey = "$pairId|$peerPublicB64|$saltB64"
    synchronized(lock) { keyCache[cacheKey]?.let { return it } }
    val sealed = prefs.getString(identityKey(pairId), null)
      ?: throw IllegalStateException("identity missing for $pairId")
    val privateDer = KeystoreBox.open(sealed)
    val keyFactory = KeyFactory.getInstance("EC")
    val privateKey = keyFactory.generatePrivate(PKCS8EncodedKeySpec(privateDer))
    val peer = keyFactory.generatePublic(X509EncodedKeySpec(B64.decode(peerPublicB64)))
    val agreement = KeyAgreement.getInstance("ECDH")
    agreement.init(privateKey)
    agreement.doPhase(peer, true)
    val secret = agreement.generateSecret()
    val derived = hkdf(secret, B64.decode(saltB64), "qi/msg/v1".toByteArray(), 32)
    val key = SecretKeySpec(derived, "AES")
    synchronized(lock) { keyCache[cacheKey] = key }
    return key
  }

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

  @ReactMethod
  fun seal(pairId: String, peerPublicB64: String, saltB64: String, plainB64: String, promise: Promise) {
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, sharedKey(pairId, peerPublicB64, saltB64))
      val nonce = cipher.iv
      val ciphertext = cipher.doFinal(B64.decode(plainB64))
      val result = WritableNativeMap()
      result.putString("nonce", B64.encode(nonce))
      result.putString("ciphertext", B64.encode(ciphertext))
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("crypto_error", error.message, error)
    }
  }

  @ReactMethod
  fun open(
    pairId: String,
    peerPublicB64: String,
    saltB64: String,
    nonceB64: String,
    ciphertextB64: String,
    promise: Promise
  ) {
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
        Cipher.DECRYPT_MODE,
        sharedKey(pairId, peerPublicB64, saltB64),
        GCMParameterSpec(128, B64.decode(nonceB64))
      )
      val plain = cipher.doFinal(B64.decode(ciphertextB64))
      promise.resolve(B64.encode(plain))
    } catch (error: Exception) {
      promise.reject("crypto_error", "无法解密：配对密钥不匹配", error)
    }
  }

  @ReactMethod
  fun sha256Hex(dataB64: String, promise: Promise) {
    val digest = MessageDigest.getInstance("SHA-256").digest(B64.decode(dataB64))
    promise.resolve(digest.joinToString("") { "%02x".format(it) })
  }

  @ReactMethod
  fun randomBytes(size: Int, promise: Promise) {
    val bytes = ByteArray(size.coerceIn(1, 256))
    random.nextBytes(bytes)
    promise.resolve(B64.encode(bytes))
  }

  /** Six-digit short authentication string shown on both devices. */
  @ReactMethod
  fun sasCode(
    publicA: String,
    publicB: String,
    pairId: String,
    codeHash: String,
    promise: Promise
  ) {
    val ordered = listOf(publicA, publicB).sorted()
    val material = MessageDigest.getInstance("SHA-256").digest(
      (ordered[0] + "|" + ordered[1] + "|" + pairId + "|" + codeHash).toByteArray()
    )
    var value = 0L
    for (index in 0 until 8) {
      value = (value shl 8) or (material[index].toLong() and 0xFF)
    }
    promise.resolve("%06d".format(value % 1_000_000L))
  }
}
