package com.inorinal.qi

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Keystore-encrypted key/value storage for tokens, consent proofs and cursors. */
class SecureStoreModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val prefs =
    reactContext.getSharedPreferences("qi.secrets", Context.MODE_PRIVATE)

  override fun getName(): String = "QiSecureStore"

  @ReactMethod
  fun setSecret(key: String, value: String, promise: Promise) {
    try {
      prefs.edit().putString(key, KeystoreBox.seal(value.toByteArray(Charsets.UTF_8))).apply()
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("secure_store_error", error.message, error)
    }
  }

  @ReactMethod
  fun getSecret(key: String, promise: Promise) {
    try {
      val sealed = prefs.getString(key, null)
      if (sealed == null) {
        promise.resolve(null)
        return
      }
      promise.resolve(String(KeystoreBox.open(sealed), Charsets.UTF_8))
    } catch (error: Exception) {
      promise.reject("secure_store_error", "无法读取本地密钥：$key", error)
    }
  }

  @ReactMethod
  fun deleteSecret(key: String, promise: Promise) {
    prefs.edit().remove(key).apply()
    promise.resolve(true)
  }
}
