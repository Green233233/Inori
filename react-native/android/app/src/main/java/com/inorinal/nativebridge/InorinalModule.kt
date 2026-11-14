package com.inorinal.nativebridge

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * File system / media / picker bridge for the RN rewrite.
 *
 * All file IO runs on a dedicated single-thread executor and every JS-facing method that can fail
 * rejects with a stable error code. Paths are canonicalised and confined to app-private storage.
 */
class InorinalModule(
    private val reactAppContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactAppContext), ActivityEventListener {

  private val executor = Executors.newSingleThreadExecutor()
  private val requestCounter = AtomicInteger(0)

  private val pendingImagePicks = ConcurrentHashMap<Int, PendingImagePick>()
  private val pendingDocumentPicks = ConcurrentHashMap<Int, PendingDocumentPick>()
  private val pendingDocumentSaves = ConcurrentHashMap<Int, PendingDocumentSave>()

  private data class PendingImagePick(val promise: Promise, val maxBytes: Long, val stickerMode: Boolean)
  private data class PendingDocumentPick(val promise: Promise)
  private data class PendingDocumentSave(val promise: Promise, val bytes: ByteArray)

  private data class EncodedImage(
      val bytes: ByteArray,
      val width: Int,
      val height: Int,
      val extension: String,
      val mimeType: String,
  )

  private class InorinalException(val code: String, message: String) : Exception(message)

  init {
    reactAppContext.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> {
    val externalLogs = runCatching { reactAppContext.getExternalFilesDir("logs") }.getOrNull()
    val logsDir = externalLogs ?: File(reactAppContext.noBackupFilesDir, "logs")
    logsDir.mkdirs()
    return mapOf(
        "filesDir" to reactAppContext.filesDir.absolutePath,
        "cacheDir" to reactAppContext.cacheDir.absolutePath,
        "logsDir" to logsDir.absolutePath,
        "versionName" to VERSION_NAME,
        "versionCode" to VERSION_CODE,
    )
  }

  // ==================== file IO ====================

  @ReactMethod
  fun readText(path: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveSafePath(path)
      if (!file.isFile) throw InorinalException("READ_FAILED", "File does not exist: $path")
      file.readText(Charsets.UTF_8)
    }
  }

  @ReactMethod
  fun writeText(path: String, content: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveSafePath(path)
      writeAtomic(file, content.toByteArray(Charsets.UTF_8))
      true
    }
  }

  @ReactMethod
  fun appendText(path: String, content: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveSafePath(path)
      val parent = file.parentFile
      if (parent != null && !parent.exists() && !parent.mkdirs()) {
        throw InorinalException("WRITE_FAILED", "Cannot create directory: ${parent.absolutePath}")
      }
      FileOutputStream(file, true).use { it.write(content.toByteArray(Charsets.UTF_8)) }
      true
    }
  }

  @ReactMethod
  fun readBase64(path: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveSafePath(path)
      if (!file.isFile) throw InorinalException("READ_FAILED", "File does not exist: $path")
      Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
    }
  }

  @ReactMethod
  fun writeBase64(path: String, base64: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveSafePath(path)
      val bytes = decodeBase64(base64)
      writeAtomic(file, bytes)
      true
    }
  }

  @ReactMethod
  fun exists(path: String, promise: Promise) {
    runAsync(promise) { resolveSafePath(path).exists() }
  }

  @ReactMethod
  fun makeDir(path: String, promise: Promise) {
    runAsync(promise) {
      val dir = resolveSafePath(path)
      dir.isDirectory || dir.mkdirs()
    }
  }

  @ReactMethod
  fun deletePath(path: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveSafePath(path)
      if (file.exists()) file.deleteRecursively()
      !file.exists()
    }
  }

  @ReactMethod
  fun listDir(path: String, promise: Promise) {
    runAsync(promise) {
      val dir = resolveSafePath(path)
      val array: WritableArray = Arguments.createArray()
      if (!dir.isDirectory) return@runAsync array
      dir.listFiles()
          ?.sortedBy { it.name }
          ?.forEach { file ->
            val map = Arguments.createMap()
            map.putString("name", file.name)
            map.putString("path", file.absolutePath)
            map.putDouble("size", file.length().toDouble())
            map.putBoolean("isDirectory", file.isDirectory)
            map.putDouble("lastModified", file.lastModified().toDouble())
            array.pushMap(map)
          }
      array
    }
  }

  // ==================== image / sticker pickers ====================

  @ReactMethod
  fun pickImage(maxBytes: Double, stickerMode: Boolean, promise: Promise) {
    val activity = reactAppContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No foreground activity to launch the picker")
      return
    }
    val requestCode = nextRequestCode()
    val effectiveMaxBytes =
        if (maxBytes.isFinite() && maxBytes > 0) maxBytes.toLong() else MAX_STICKER_BYTES.toLong()
    pendingImagePicks[requestCode] = PendingImagePick(promise, effectiveMaxBytes, stickerMode)

    reactAppContext.runOnUiQueueThread {
      try {
        val intent =
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
              addCategory(Intent.CATEGORY_OPENABLE)
              type = "image/*"
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        activity.startActivityForResult(intent, requestCode)
      } catch (t: Throwable) {
        pendingImagePicks.remove(requestCode)
        promise.reject(
            "IMAGE_PROCESSING_FAILED",
            t.message ?: "Unable to launch the image picker",
            t,
        )
      }
    }
  }

  @ReactMethod
  fun listStickers(promise: Promise) {
    runAsync(promise) {
      val array: WritableArray = Arguments.createArray()
      stickerRoot()
          .listFiles()
          ?.filter { it.isFile && isSafeFileName(it.name) }
          ?.sortedByDescending { it.lastModified() }
          ?.forEach { file ->
            val map = Arguments.createMap()
            map.putString("id", file.name.substringBeforeLast('.'))
            map.putString("fileName", file.name)
            map.putString("mime", mimeTypeForExtension(file.extension))
            map.putString("path", file.absolutePath)
            map.putDouble("size", file.length().toDouble())
            map.putDouble("lastModified", file.lastModified().toDouble())
            array.pushMap(map)
          }
      array
    }
  }

  @ReactMethod
  fun stickerBase64(fileName: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveStickerFile(fileName)
      if (!file.isFile) throw InorinalException("NOT_FOUND", "Sticker not found: $fileName")
      Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
    }
  }

  @ReactMethod
  fun deleteSticker(fileName: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveStickerFile(fileName)
      if (file.exists()) file.delete()
      !file.exists()
    }
  }

  @ReactMethod
  fun writeStickerBase64(fileName: String, base64: String, promise: Promise) {
    runAsync(promise) {
      val file = resolveStickerFile(fileName)
      if (!file.exists()) {
        writeAtomic(file, decodeBase64(base64))
      }
      true
    }
  }

  // ==================== document pickers ====================

  @ReactMethod
  fun pickDocument(promise: Promise) {
    val activity = reactAppContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No foreground activity to launch the picker")
      return
    }
    val requestCode = nextRequestCode()
    pendingDocumentPicks[requestCode] = PendingDocumentPick(promise)

    reactAppContext.runOnUiQueueThread {
      try {
        val intent =
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
              addCategory(Intent.CATEGORY_OPENABLE)
              type = "*/*"
              putExtra(
                  Intent.EXTRA_MIME_TYPES,
                  arrayOf("application/zip", "application/json", "*/*"),
              )
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        activity.startActivityForResult(intent, requestCode)
      } catch (t: Throwable) {
        pendingDocumentPicks.remove(requestCode)
        promise.reject("PICK_DOCUMENT_FAILED", t.message ?: "Unable to open document picker", t)
      }
    }
  }

  @ReactMethod
  fun saveDocument(base64: String, fileName: String, mime: String, promise: Promise) {
    val activity = reactAppContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No foreground activity to launch the saver")
      return
    }
    val bytes =
        try {
          decodeBase64(base64)
        } catch (t: Throwable) {
          promise.reject("INVALID_BASE64", t.message ?: "Unable to decode base64 content", t)
          return
        }
    val safeName = sanitizeFileName(fileName)
    val requestCode = nextRequestCode()
    pendingDocumentSaves[requestCode] = PendingDocumentSave(promise, bytes)

    reactAppContext.runOnUiQueueThread {
      try {
        val intent =
            Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
              addCategory(Intent.CATEGORY_OPENABLE)
              type = mime.ifBlank { "application/octet-stream" }
              putExtra(Intent.EXTRA_TITLE, safeName)
              addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
        activity.startActivityForResult(intent, requestCode)
      } catch (t: Throwable) {
        pendingDocumentSaves.remove(requestCode)
        promise.reject("SAVE_DOCUMENT_FAILED", t.message ?: "Unable to open document saver", t)
      }
    }
  }

  // ==================== html media handling ====================

  @ReactMethod
  fun toDisplayableHtml(entryId: String, html: String, promise: Promise) {
    runAsync(promise) {
      var result: String =
          EDITOR_MEDIA_URI_REGEX.replace(html) { match ->
            val id = match.groupValues[1]
            val fileName = match.groupValues[2]
            if (!SAFE_ENTRY_ID_REGEX.matches(id) || !isSafeFileName(fileName)) {
              match.value
            } else {
              fileToDataUri(File(mediaRoot(), id), fileName) ?: match.value
            }
          }

      result =
          FILE_URI_REGEX.replace(result) { match ->
            val path = runCatching { Uri.parse(match.value).path.orEmpty() }.getOrNull()
            val file =
                runCatching { File(path.orEmpty()).canonicalFile }.getOrNull()
                    ?: return@replace match.value
            if (!isUnderMediaRoot(file)) {
              match.value
            } else {
              fileToDataUri(file.parentFile, file.name) ?: match.value
            }
          }
      result
    }
  }

  @ReactMethod
  fun toStoredHtml(entryId: String, html: String, promise: Promise) {
    runAsync(promise) {
      if (!SAFE_ENTRY_ID_REGEX.matches(entryId)) {
        throw InorinalException("INVALID_PATH", "Invalid journal entry id")
      }
      val dir = File(mediaRoot(), entryId)
      var mediaCount = 0

      val result: String =
          DATA_IMAGE_REGEX.replace(html) { match ->
            val subtype = match.groupValues[1].lowercase(Locale.US)
            val base64 = match.groupValues[2].replace(WHITESPACE_REGEX, "")
            val bytes =
                runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull()
                    ?: return@replace match.value
            if (bytes.isEmpty()) return@replace match.value

            val extension =
                when (subtype) {
                  "jpeg" -> "jpg"
                  "svg+xml" -> "svg"
                  else -> subtype
                }
            val safeExtension =
                extension.takeIf { it.matches(SAFE_EXTENSION_REGEX) } ?: "bin"
            val fileName = "${sha256(bytes)}.$safeExtension"
            val target = File(dir, fileName)
            if (!target.exists()) {
              writeAtomic(target, bytes)
            }
            mediaCount++
            "journal-media://local/$entryId/$fileName"
          }

      val map = Arguments.createMap()
      map.putString("html", result)
      map.putInt("mediaCount", mediaCount)
      map
    }
  }

  @ReactMethod
  fun deleteEntryMedia(entryId: String, promise: Promise) {
    runAsync(promise) {
      if (!SAFE_ENTRY_ID_REGEX.matches(entryId)) {
        throw InorinalException("INVALID_PATH", "Invalid journal entry id")
      }
      val root = mediaRoot().canonicalFile
      val directory = File(root, entryId).canonicalFile
      if (directory.parentFile != root) {
        throw InorinalException("INVALID_PATH", "Entry media path escaped its root")
      }
      if (directory.exists()) directory.deleteRecursively()
      !directory.exists()
    }
  }

  @ReactMethod
  fun clearCache(promise: Promise) {
    runAsync(promise) {
      val cacheDir = reactAppContext.cacheDir
      cacheDir.listFiles()?.forEach { it.deleteRecursively() }
      true
    }
  }

  /**
   * One-time migration helper: read (never mutate) the legacy Compose Room database left behind by
   * the previous build, which shared the same applicationId. Rejects with LEGACY_READ_FAILED.
   */
  @ReactMethod
  fun readLegacyEntries(promise: Promise) {
    executor.execute {
      var database: SQLiteDatabase? = null
      try {
        val dbFile = reactAppContext.getDatabasePath("journal_database")
        if (!dbFile.exists()) {
          promise.resolve(Arguments.createArray())
          return@execute
        }
        val db =
            SQLiteDatabase.openDatabase(
                dbFile.absolutePath,
                null,
                SQLiteDatabase.OPEN_READONLY,
            )
        database = db
        val array: WritableArray = Arguments.createArray()
        db.rawQuery(
                "SELECT id,title,content,date,weather,mood,category,isFavorite,imageUrl," +
                    "createdAt,updatedAt FROM journal_entries ORDER BY createdAt DESC",
                null,
            )
            .use { cursor ->
              while (cursor.moveToNext()) {
                val map = Arguments.createMap()
                map.putString("id", cursor.getString(0))
                map.putString("title", cursor.getString(1) ?: "")
                map.putString("content", cursor.getString(2) ?: "")
                map.putString("date", cursor.getString(3) ?: "")
                map.putString("weather", cursor.getString(4) ?: "SUNNY")
                map.putString("mood", cursor.getString(5) ?: "HAPPY")
                map.putString("category", cursor.getString(6) ?: "DAILY")
                map.putBoolean("isFavorite", cursor.getInt(7) == 1)
                map.putString("imageUrl", if (cursor.isNull(8)) null else cursor.getString(8))
                map.putDouble("createdAt", cursor.getLong(9).toDouble())
                map.putDouble("updatedAt", cursor.getLong(10).toDouble())
                array.pushMap(map)
              }
            }
        promise.resolve(array)
      } catch (t: Throwable) {
        promise.reject(
            "LEGACY_READ_FAILED",
            t.message ?: "Unable to read the legacy journal database",
            t,
        )
      } finally {
        runCatching { database?.close() }
      }
    }
  }

  // ==================== activity result plumbing ====================

  override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
  ) {
    pendingImagePicks.remove(requestCode)?.let { pending ->
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) {
        pending.promise.reject("CANCELLED", "Image selection cancelled")
        return
      }
      // Read the stream synchronously, before this callback returns, then process async.
      val bytes =
          try {
            activity.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw InorinalException("IMAGE_PROCESSING_FAILED", "Empty image stream")
          } catch (t: Throwable) {
            pending.promise.reject(
                "IMAGE_PROCESSING_FAILED",
                t.message ?: "Unable to read selected image",
                t,
            )
            return
          }
      executor.execute {
        try {
          val map =
              if (pending.stickerMode) {
                importSticker(bytes, pending.maxBytes)
              } else {
                encodePhotoResult(bytes)
              }
          pending.promise.resolve(map)
        } catch (t: Throwable) {
          pending.promise.reject(
              "IMAGE_PROCESSING_FAILED",
              t.message ?: "Unable to process the selected image",
              t,
          )
        }
      }
      return
    }

    pendingDocumentPicks.remove(requestCode)?.let { pending ->
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) {
        pending.promise.reject("CANCELLED", "Document selection cancelled")
        return
      }
      executor.execute {
        try {
          val resolver = activity.contentResolver
          val displayName = queryDisplayName(resolver, uri) ?: uri.lastPathSegment ?: "document"
          val safeName = sanitizeFileName(displayName)
          val importsDir = File(reactAppContext.cacheDir, "imports").also { it.mkdirs() }
          val target = File(importsDir, "${System.currentTimeMillis()}_$safeName")
          resolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
          } ?: throw InorinalException("PICK_DOCUMENT_FAILED", "Empty document stream")

          val map = Arguments.createMap()
          map.putString("path", target.absolutePath)
          map.putString("name", safeName)
          map.putDouble("size", target.length().toDouble())
          pending.promise.resolve(map)
        } catch (t: Throwable) {
          pending.promise.reject(
              "PICK_DOCUMENT_FAILED",
              t.message ?: "Unable to import the selected document",
              t,
          )
        }
      }
      return
    }

    pendingDocumentSaves.remove(requestCode)?.let { pending ->
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) {
        pending.promise.reject("CANCELLED", "Document save cancelled")
        return
      }
      executor.execute {
        try {
          reactAppContext.contentResolver.openOutputStream(uri, "wt")?.use { output ->
            output.write(pending.bytes)
            output.flush()
          } ?: throw InorinalException("SAVE_DOCUMENT_FAILED", "Unable to open destination")
          pending.promise.resolve(uri.toString())
        } catch (t: Throwable) {
          pending.promise.reject(
              "SAVE_DOCUMENT_FAILED",
              t.message ?: "Unable to write the document",
              t,
          )
        }
      }
      Unit
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  override fun invalidate() {
    reactAppContext.removeActivityEventListener(this)
    executor.shutdownNow()
    super.invalidate()
  }

  // ==================== photo encoding ====================

  private fun encodePhotoResult(source: ByteArray): WritableMap {
    var encoded: EncodedImage? =
        try {
          encodeJpeg(source, 1_500_000, 75)
        } catch (_: OutOfMemoryError) {
          null
        }
    if (encoded == null) {
      encoded =
          try {
            encodeJpeg(source, 500_000, 50)
          } catch (_: OutOfMemoryError) {
            throw InorinalException(
                "IMAGE_PROCESSING_FAILED",
                "Out of memory while decoding the image",
            )
          }
    }

    val map = Arguments.createMap()
    map.putString("dataUri", toDataUri(encoded.bytes, encoded.mimeType))
    map.putString("base64", Base64.encodeToString(encoded.bytes, Base64.NO_WRAP))
    map.putString("mime", encoded.mimeType)
    map.putInt("width", encoded.width)
    map.putInt("height", encoded.height)
    return map
  }

  private fun encodeJpeg(source: ByteArray, maxPixels: Int, quality: Int): EncodedImage {
    val bounds =
        BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw InorinalException("IMAGE_PROCESSING_FAILED", "Unsupported or corrupt image")
    }

    val totalPixels = bounds.outWidth.toLong() * bounds.outHeight.toLong()
    var sampleSize = 1
    if (totalPixels > maxPixels) {
      val targetSample = Math.sqrt(totalPixels.toDouble() / maxPixels.toDouble()).toInt()
      while (sampleSize < targetSample) sampleSize *= 2
    }

    val bitmap =
        BitmapFactory.decodeByteArray(
            source,
            0,
            source.size,
            BitmapFactory.Options().apply { inSampleSize = sampleSize },
        ) ?: throw InorinalException("IMAGE_PROCESSING_FAILED", "Unable to decode image")

    var scaled = bitmap
    val currentPixels = bitmap.width.toLong() * bitmap.height.toLong()
    if (currentPixels > maxPixels) {
      val scale = Math.sqrt(maxPixels.toDouble() / currentPixels.toDouble())
      val width = (bitmap.width * scale).toInt().coerceAtLeast(1)
      val height = (bitmap.height * scale).toInt().coerceAtLeast(1)
      scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
      if (scaled !== bitmap) bitmap.recycle()
    }

    val output = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, quality, output)
    val width = scaled.width
    val height = scaled.height
    scaled.recycle()
    val bytes = output.toByteArray()
    output.close()
    return EncodedImage(bytes, width, height, "jpg", "image/jpeg")
  }

  // ==================== sticker encoding ====================

  private fun importSticker(source: ByteArray, maxBytes: Long): WritableMap {
    val encoded =
        compressStickerUnderLimit(source, maxBytes)
            ?: throw InorinalException(
                "IMAGE_PROCESSING_FAILED",
                "Unable to compress the sticker under the size limit",
            )

    val id = "${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
    val fileName = "$id.${encoded.extension}"
    val target = File(stickerRoot(), fileName)
    writeAtomic(target, encoded.bytes)

    val map = Arguments.createMap()
    map.putString("dataUri", toDataUri(encoded.bytes, encoded.mimeType))
    map.putString("base64", Base64.encodeToString(encoded.bytes, Base64.NO_WRAP))
    map.putString("mime", encoded.mimeType)
    map.putInt("width", encoded.width)
    map.putInt("height", encoded.height)
    map.putString("fileName", fileName)
    map.putString("id", id)
    return map
  }

  /** Mirrors UserStickerStore.compressUnderLimit (PNG kept while alpha, flattened when huge). */
  private fun compressStickerUnderLimit(source: ByteArray, maxBytes: Long): EncodedImage? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var maxPixels = 512_000
    var quality = 85
    repeat(8) {
      val encoded = encodeStickerOnce(source, maxPixels, quality) ?: return@repeat
      if (encoded.bytes.size <= maxBytes) return encoded
      maxPixels = (maxPixels * 0.65).toInt().coerceAtLeast(40_000)
      quality = (quality - 10).coerceAtLeast(40)
    }
    return encodeStickerOnce(source, 40_000, 40)?.takeIf { it.bytes.size <= maxBytes }
  }

  private fun encodeStickerOnce(source: ByteArray, maxPixels: Int, quality: Int): EncodedImage? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val totalPixels = bounds.outWidth.toLong() * bounds.outHeight.toLong()
    var sampleSize = 1
    if (totalPixels > maxPixels) {
      val targetSample = Math.sqrt(totalPixels.toDouble() / maxPixels.toDouble()).toInt()
      while (sampleSize < targetSample) sampleSize *= 2
    }

    val bitmap =
        BitmapFactory.decodeByteArray(
            source,
            0,
            source.size,
            BitmapFactory.Options().apply { inSampleSize = sampleSize },
        ) ?: return null

    var scaled = bitmap
    val currentPixels = bitmap.width.toLong() * bitmap.height.toLong()
    if (currentPixels > maxPixels) {
      val scale = Math.sqrt(maxPixels.toDouble() / currentPixels.toDouble())
      val width = (bitmap.width * scale).toInt().coerceAtLeast(1)
      val height = (bitmap.height * scale).toInt().coerceAtLeast(1)
      scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
      if (scaled !== bitmap) bitmap.recycle()
    }

    val width = scaled.width
    val height = scaled.height
    val output = ByteArrayOutputStream()
    val keepAlpha = scaled.hasAlpha()
    val encoded: EncodedImage
    if (keepAlpha) {
      scaled.compress(Bitmap.CompressFormat.PNG, 100, output)
      if (output.size() > MAX_STICKER_BYTES) {
        output.reset()
        val flattened = scaled.copy(Bitmap.Config.ARGB_8888, false)
        flattened.compress(Bitmap.CompressFormat.JPEG, quality, output)
        if (flattened !== scaled) flattened.recycle()
        encoded = EncodedImage(output.toByteArray(), width, height, "jpg", "image/jpeg")
      } else {
        encoded = EncodedImage(output.toByteArray(), width, height, "png", "image/png")
      }
    } else {
      scaled.compress(Bitmap.CompressFormat.JPEG, quality, output)
      encoded = EncodedImage(output.toByteArray(), width, height, "jpg", "image/jpeg")
    }
    if (!scaled.isRecycled) scaled.recycle()
    output.close()
    return encoded
  }

  // ==================== helpers ====================

  private fun runAsync(promise: Promise, block: () -> Any?) {
    executor.execute {
      try {
        promise.resolve(block())
      } catch (e: InorinalException) {
        promise.reject(e.code, e.message)
      } catch (t: Throwable) {
        promise.reject("NATIVE_ERROR", t.message ?: t.javaClass.simpleName, t)
      }
    }
  }

  private fun allowedRoots(): List<File> {
    val roots = mutableListOf<File>()
    roots.add(reactAppContext.filesDir)
    roots.add(reactAppContext.cacheDir)
    roots.add(reactAppContext.noBackupFilesDir)
    reactAppContext.getExternalFilesDir(null)?.let { roots.add(it) }
    reactAppContext.externalCacheDir?.let { roots.add(it) }
    runCatching {
      reactAppContext.getExternalFilesDirs(null)?.filterNotNull()?.forEach { roots.add(it) }
    }
    return roots
  }

  private fun resolveSafePath(path: String): File {
    if (path.isBlank()) throw InorinalException("INVALID_PATH", "Empty path")
    val raw = File(path)
    if (!raw.isAbsolute) {
      throw InorinalException("INVALID_PATH", "Path must be absolute: $path")
    }
    val canonical =
        runCatching { raw.canonicalFile }
            .getOrElse { throw InorinalException("INVALID_PATH", "Unable to resolve path: $path") }
    val allowed =
        allowedRoots().any { root ->
          val rootPath = runCatching { root.canonicalPath }.getOrNull() ?: return@any false
          canonical.path == rootPath || canonical.path.startsWith(rootPath + File.separator)
        }
    if (!allowed) {
      throw InorinalException("INVALID_PATH", "Path is outside app-private storage: $path")
    }
    return canonical
  }

  private fun writeAtomic(target: File, bytes: ByteArray) {
    val parent = target.parentFile
    if (parent != null && !parent.exists() && !parent.mkdirs()) {
      throw InorinalException("WRITE_FAILED", "Cannot create directory: ${parent.absolutePath}")
    }
    val tmp = File(target.path + ".tmp")
    try {
      FileOutputStream(tmp).use { output ->
        output.write(bytes)
        output.flush()
        output.fd.sync()
      }
      if (!tmp.renameTo(target)) {
        // Fallback for filesystems where rename-over-existing is not supported.
        tmp.copyTo(target, overwrite = true)
        tmp.delete()
      }
    } catch (t: Throwable) {
      tmp.delete()
      if (t is InorinalException) throw t
      throw InorinalException("WRITE_FAILED", t.message ?: "Unable to write ${target.name}")
    }
  }

  private fun decodeBase64(base64: String): ByteArray {
    return try {
      Base64.decode(base64, Base64.DEFAULT)
    } catch (t: Throwable) {
      throw InorinalException("INVALID_BASE64", t.message ?: "Unable to decode base64 content")
    }
  }

  private fun stickerRoot(): File = File(reactAppContext.filesDir, STICKER_DIR).also { it.mkdirs() }

  private fun mediaRoot(): File = File(reactAppContext.filesDir, MEDIA_DIR)

  private fun isSafeFileName(name: String): Boolean =
      name.length in 1..255 &&
          name != "." &&
          name != ".." &&
          SAFE_FILE_NAME_REGEX.matches(name)

  private fun resolveSticker(filename: String): File? {
    if (!isSafeFileName(filename)) return null
    val root = stickerRoot().canonicalFile
    val candidate = File(root, filename).canonicalFile
    if (candidate.parentFile != root) return null
    if (candidate.exists()) return candidate
    if ('.' !in filename) {
      val match = root.listFiles()?.firstOrNull { it.isFile && it.name.substringBeforeLast('.') == filename }
      if (match != null) {
        val canonical = match.canonicalFile
        if (canonical.parentFile == root) return canonical
      }
    }
    return candidate
  }

  private fun resolveStickerFile(filename: String): File {
    return resolveSticker(filename)
        ?: throw InorinalException("INVALID_PATH", "Unsafe sticker file name: $filename")
  }

  private fun fileToDataUri(dir: File?, name: String): String? {
    if (dir == null || !isSafeFileName(name)) return null
    val file =
        runCatching { File(dir, name).canonicalFile }.getOrNull() ?: return null
    val canonicalDir = runCatching { dir.canonicalFile }.getOrNull() ?: return null
    if (file.parentFile != canonicalDir || !file.isFile) return null
    val bytes = runCatching { file.readBytes() }.getOrNull() ?: return null
    if (bytes.isEmpty()) return null
    return toDataUri(bytes, mimeTypeForExtension(file.extension))
  }

  private fun isUnderMediaRoot(file: File): Boolean {
    val root = runCatching { mediaRoot().canonicalFile }.getOrNull() ?: return false
    val canonical = runCatching { file.canonicalFile }.getOrNull() ?: return false
    return canonical.path == root.path || canonical.path.startsWith(root.path + File.separator)
  }

  private fun toDataUri(bytes: ByteArray, mime: String): String =
      "data:$mime;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)

  private fun sha256(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    val builder = StringBuilder(digest.size * 2)
    for (byte in digest) builder.append(String.format(Locale.US, "%02x", byte))
    return builder.toString()
  }

  private fun mimeTypeForExtension(extension: String): String =
      when (extension.lowercase(Locale.US)) {
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "svg" -> "image/svg+xml"
        else -> "application/octet-stream"
      }

  private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? {
    return runCatching {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (index >= 0) cursor.getString(index) else null
        } else {
          null
        }
      }
    }.getOrNull()
  }

  private fun sanitizeFileName(raw: String?): String {
    val base = (raw ?: "").substringAfterLast('/').substringAfterLast('\\').trim()
    if (base.isEmpty() || base == "." || base == "..") return "document"
    val cleaned =
        base.map { char ->
          if (char.isLetterOrDigit() || char == '.' || char == '_' || char == '-') char else '_'
        }.joinToString("")
    val trimmed = cleaned.trimStart('.').ifEmpty { "document" }
    if (trimmed.length <= 100) return trimmed
    val extension = trimmed.substringAfterLast('.', "")
    val stem = trimmed.substringBeforeLast('.')
    val keep = (100 - extension.length - 1).coerceAtLeast(1)
    return buildString {
      append(stem.take(keep))
      if (extension.isNotEmpty()) append('.').append(extension.take(16))
    }
  }

  private fun nextRequestCode(): Int {
    var code: Int
    do {
      code = 4100 + (requestCounter.incrementAndGet() % 20000)
    } while (
        pendingImagePicks.containsKey(code) ||
            pendingDocumentPicks.containsKey(code) ||
            pendingDocumentSaves.containsKey(code)
    )
    return code
  }

  companion object {
    const val NAME = "InorinalNative"
    private const val VERSION_NAME = "Alpha v0.5.1-react"
    private const val VERSION_CODE = 7

    private const val STICKER_DIR = "user_stickers"
    private const val MEDIA_DIR = "journal_media"
    private const val MAX_STICKER_BYTES = 256 * 1024

    private val SAFE_ENTRY_ID_REGEX = Regex("[A-Za-z0-9_-]{1,128}")
    private val SAFE_FILE_NAME_REGEX = Regex("[A-Za-z0-9._-]{1,255}")
    private val SAFE_EXTENSION_REGEX = Regex("[a-z0-9]{1,8}")
    private val WHITESPACE_REGEX = Regex("\\s")
    private val DATA_IMAGE_REGEX =
        Regex("data:image/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\\r\\n]+)")
    private val FILE_URI_REGEX = Regex("file://[^\\s\"'<>]+")
    private val EDITOR_MEDIA_URI_REGEX = Regex("journal-media://local/([^/\"'<>]+)/([^\"'<>]+)")
  }
}
