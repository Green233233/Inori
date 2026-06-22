package com.green.inorinal.media

import android.content.Context
import android.net.Uri
import android.util.Base64
import java.io.File
import java.util.UUID

class JournalMediaStore(context: Context) {
    private val rootDir = File(context.filesDir, ROOT_DIR_NAME)

    fun mediaRoot(): File = rootDir

    fun entryDir(entryId: String): File = File(rootDir, entryId).also { it.mkdirs() }

    fun saveImage(entryId: String, bytes: ByteArray, extension: String = "jpg"): File {
        val safeExtension = extension.lowercase().trimStart('.').ifBlank { "jpg" }
        val file = File(entryDir(entryId), "${System.currentTimeMillis()}_${UUID.randomUUID()}.$safeExtension")
        file.writeBytes(bytes)
        return file
    }

    fun migrateInlineImages(entryId: String, html: String): String {
        if (!html.contains("data:image/")) return html

        return DATA_IMAGE_REGEX.replace(html) { match ->
            val extension = when (match.groupValues[1].lowercase()) {
                "jpeg" -> "jpg"
                "svg+xml" -> "svg"
                else -> match.groupValues[1].lowercase()
            }
            val bytes = runCatching {
                Base64.decode(match.groupValues[2], Base64.DEFAULT)
            }.getOrNull() ?: return@replace match.value

            val file = saveImage(entryId, bytes, extension)
            file.toUriString()
        }
    }

    fun toDisplayableHtml(html: String): String = html

    fun referencedMediaFiles(html: String): List<File> {
        return FILE_URI_REGEX.findAll(html)
            .mapNotNull { match ->
                runCatching { File(Uri.parse(match.value).path.orEmpty()) }.getOrNull()
            }
            .filter { file ->
                file.exists() && file.canonicalPath.startsWith(rootDir.canonicalPath)
            }
            .distinctBy { it.canonicalPath }
            .toList()
    }

    fun toBackupHtml(html: String): String {
        val rootPath = rootDir.canonicalPath
        return FILE_URI_REGEX.replace(html) { match ->
            val file = runCatching { File(Uri.parse(match.value).path.orEmpty()) }.getOrNull()
                ?: return@replace match.value
            val canonicalPath = runCatching { file.canonicalPath }.getOrNull() ?: return@replace match.value
            if (!canonicalPath.startsWith(rootPath)) return@replace match.value
            "media/${file.parentFile?.name.orEmpty()}/${file.name}"
        }
    }

    fun restoreBackupHtml(html: String): String {
        return BACKUP_MEDIA_REGEX.replace(html) { match ->
            val entryId = match.groupValues[1]
            val fileName = match.groupValues[2]
            File(entryDir(entryId), fileName).toUriString()
        }
    }

    companion object {
        const val ROOT_DIR_NAME = "journal_media"

        private val DATA_IMAGE_REGEX =
            Regex("""data:image/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\r\n]+)""")
        private val FILE_URI_REGEX =
            Regex("""file://[^\s"'<>]+""")
        private val BACKUP_MEDIA_REGEX =
            Regex("""media/([^/"'<>]+)/([^"'<>]+)""")

        fun File.toUriString(): String = Uri.fromFile(this).toString()
    }
}
