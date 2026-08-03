package com.green.inorinal.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/**
 * App-wide library of user-imported stickers (shared across journal entries).
 * Files live under filesDir/user_stickers/.
 */
class UserStickerStore(context: Context) {
    private val rootDir = File(context.applicationContext.filesDir, ROOT_DIR_NAME).also { it.mkdirs() }

    data class StickerItem(
        val id: String,
        val fileName: String,
        val mimeType: String,
        val file: File
    )

    fun root(): File = rootDir

    fun listStickers(): List<StickerItem> {
        if (!rootDir.exists()) return emptyList()
        return rootDir.listFiles()
            ?.filter { it.isFile && isSafeFileName(it.name) }
            ?.sortedByDescending { it.lastModified() }
            ?.mapNotNull { file ->
                val id = file.name.substringBeforeLast('.', missingDelimiterValue = file.name)
                if (!isSafeId(id)) return@mapNotNull null
                StickerItem(
                    id = id,
                    fileName = file.name,
                    mimeType = mimeTypeForFile(file),
                    file = file
                )
            }
            .orEmpty()
    }

    fun getSticker(id: String): StickerItem? =
        listStickers().firstOrNull { it.id == id }

    fun deleteSticker(id: String): Boolean {
        if (!isSafeId(id)) return false
        val root = rootDir.canonicalFile
        return rootDir.listFiles()
            ?.filter { it.isFile && it.name.substringBeforeLast('.') == id }
            ?.map { file ->
                val canonical = file.canonicalFile
                canonical.parentFile == root && canonical.delete()
            }
            ?.any { it } == true
    }

    /**
     * Compress [sourceBytes] to at most [maxBytes] and persist in the library.
     * Returns the saved item, or null on failure.
     */
    fun importSticker(sourceBytes: ByteArray, maxBytes: Int = MAX_STICKER_BYTES): StickerItem? {
        require(sourceBytes.isNotEmpty()) { "Empty sticker" }
        val encoded = compressUnderLimit(sourceBytes, maxBytes) ?: return null
        val id = "${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
        val file = File(rootDir, "$id.${encoded.extension}")
        file.writeBytes(encoded.bytes)
        return StickerItem(id = id, fileName = file.name, mimeType = encoded.mimeType, file = file)
    }

    fun fileToDataUri(file: File): String? {
        if (!file.exists() || !isUnderRoot(file)) return null
        val bytes = runCatching { file.readBytes() }.getOrNull() ?: return null
        if (bytes.isEmpty()) return null
        return "data:${mimeTypeForFile(file)};base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    fun importFromBackupFile(fileName: String, bytes: ByteArray): Boolean {
        if (!isSafeFileName(fileName) || bytes.isEmpty() || bytes.size > MAX_STICKER_BYTES * 2) return false
        val target = File(rootDir, fileName)
        if (target.exists()) return true
        target.writeBytes(bytes)
        return true
    }

    fun allFilesForExport(): List<File> =
        rootDir.listFiles()?.filter { it.isFile && isSafeFileName(it.name) }.orEmpty()

    private fun isUnderRoot(file: File): Boolean {
        val root = rootDir.canonicalFile
        val canonical = runCatching { file.canonicalFile }.getOrNull() ?: return false
        return canonical.path.startsWith(root.path + File.separator) || canonical == root
    }

    private data class Encoded(
        val bytes: ByteArray,
        val extension: String,
        val mimeType: String
    )

    private fun compressUnderLimit(sourceBytes: ByteArray, maxBytes: Int): Encoded? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(sourceBytes, 0, sourceBytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var maxPixels = 512_000
        var quality = 85
        repeat(8) {
            val encoded = encodeOnce(sourceBytes, maxPixels, quality) ?: return@repeat
            if (encoded.bytes.size <= maxBytes) return encoded
            maxPixels = (maxPixels * 0.65).toInt().coerceAtLeast(40_000)
            quality = (quality - 10).coerceAtLeast(40)
        }
        // Last resort: very small JPEG
        return encodeOnce(sourceBytes, 40_000, 40)?.takeIf { it.bytes.size <= maxBytes }
    }

    private fun encodeOnce(sourceBytes: ByteArray, maxPixels: Int, quality: Int): Encoded? {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(sourceBytes, 0, sourceBytes.size, options)
        val totalPixels = options.outWidth.toLong() * options.outHeight.toLong()
        var sampleSize = 1
        if (totalPixels > maxPixels) {
            val targetSample = Math.sqrt(totalPixels.toDouble() / maxPixels.toDouble()).toInt()
            while (sampleSize < targetSample) sampleSize *= 2
        }
        val bitmap = BitmapFactory.decodeByteArray(
            sourceBytes,
            0,
            sourceBytes.size,
            BitmapFactory.Options().apply { inSampleSize = sampleSize }
        ) ?: return null

        var scaled = bitmap
        val currentPixels = bitmap.width.toLong() * bitmap.height
        if (currentPixels > maxPixels) {
            val scale = Math.sqrt(maxPixels.toDouble() / currentPixels.toDouble())
            val w = (bitmap.width * scale).toInt().coerceAtLeast(1)
            val h = (bitmap.height * scale).toInt().coerceAtLeast(1)
            scaled = Bitmap.createScaledBitmap(bitmap, w, h, true)
            if (scaled != bitmap) bitmap.recycle()
        }

        val stream = ByteArrayOutputStream()
        val keepAlpha = scaled.hasAlpha()
        val encoded = if (keepAlpha) {
            scaled.compress(Bitmap.CompressFormat.PNG, 100, stream)
            // If PNG still huge, flatten to JPEG
            if (stream.size() > MAX_STICKER_BYTES) {
                stream.reset()
                val flat = scaled.copy(Bitmap.Config.ARGB_8888, false)
                flat.compress(Bitmap.CompressFormat.JPEG, quality, stream)
                if (!flat.isRecycled) flat.recycle()
                Encoded(stream.toByteArray(), "jpg", "image/jpeg")
            } else {
                Encoded(stream.toByteArray(), "png", "image/png")
            }
        } else {
            scaled.compress(Bitmap.CompressFormat.JPEG, quality, stream)
            Encoded(stream.toByteArray(), "jpg", "image/jpeg")
        }
        if (!scaled.isRecycled) scaled.recycle()
        stream.close()
        return encoded
    }

    private fun mimeTypeForFile(file: File): String =
        when (file.extension.lowercase()) {
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            else -> "image/jpeg"
        }

    companion object {
        const val ROOT_DIR_NAME = "user_stickers"
        const val MAX_STICKER_BYTES = 256 * 1024

        fun isSafeFileName(name: String): Boolean =
            name.matches(Regex("[A-Za-z0-9._-]{1,255}")) && name != "." && name != ".."

        fun isSafeId(id: String): Boolean =
            id.matches(Regex("[A-Za-z0-9_-]{1,80}"))
    }
}
