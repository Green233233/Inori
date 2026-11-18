package com.inorinal.qi

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-backed sealed storage.
 *
 * The Keystore holds a non-exportable AES-256-GCM key; identity private keys and
 * account tokens are stored encrypted with it. Nothing here is ever written to
 * JS: the model layer only receives ciphertext or opaque booleans.
 */
object KeystoreBox {
  private const val ALIAS = "qi.master"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val TAG_BITS = 128
  private const val NONCE_BYTES = 12

  private val lock = Any()

  private fun keyStore(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun masterKey(): SecretKey = synchronized(lock) {
    val store = keyStore()
    val existing = store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry
    if (existing != null) return existing.secretKey
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    generator.generateKey()
  }

  /** Returns `base64(nonce || ciphertext || tag)`. */
  fun seal(plain: ByteArray): String {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, masterKey())
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(plain)
    val combined = ByteArray(iv.size + ciphertext.size)
    System.arraycopy(iv, 0, combined, 0, iv.size)
    System.arraycopy(ciphertext, 0, combined, iv.size, ciphertext.size)
    return B64.encode(combined)
  }

  /** Inverse of [seal]; throws on tampering. */
  fun open(value: String): ByteArray {
    val combined = B64.decode(value)
    require(combined.size > NONCE_BYTES) { "sealed value too short" }
    val iv = combined.copyOfRange(0, NONCE_BYTES)
    val ciphertext = combined.copyOfRange(NONCE_BYTES, combined.size)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(TAG_BITS, iv))
    return cipher.doFinal(ciphertext)
  }
}

/** Base64 helpers with a single consistent flag set. */
object B64 {
  fun encode(raw: ByteArray): String =
    android.util.Base64.encodeToString(raw, android.util.Base64.NO_WRAP)

  fun decode(text: String): ByteArray =
    android.util.Base64.decode(text, android.util.Base64.NO_WRAP)
}
