package com.green.inorinal.media

import android.content.Context
import android.net.Uri
import android.util.Base64
import java.io.File
import java.util.UUID

class JournalMediaStore(context: Context) {
    private val rootDir = File(context.filesDir, ROOT_DIR_NAME)

    fun mediaRoot(): File = rootDir

    fun entryDir(entryId: String): File {
        require(isSafeEntryId(entryId)) { "Invalid journal entry id" }
        return File(rootDir, entryId).also { it.mkdirs() }
    }

    fun deleteEntryMedia(entryId: String) {
        val root = rootDir.canonicalFile
        val directory = File(root, entryId).canonicalFile
        if (directory.parentFile == root && directory.exists()) {
            directory.deleteRecursively()
        }
    }

    fun saveImage(entryId: String, bytes: ByteArray, extension: String = "jpg"): File {
        val safeExtension = extension.lowercase().trimStart('.')
            .takeIf { it.matches(Regex("[a-z0-9]{1,8}")) }
            ?: "jpg"
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
            editorMediaUri(entryId, file.name)
        }
    }

    /**
     * Convert stored media references into data URIs so WebView can display them
     * without relying on cross-origin file:// access from android_asset pages.
     */
    fun toDisplayableHtml(html: String): String {
        if (html.isEmpty()) return html
        var result = EDITOR_MEDIA_URI_REGEX.replace(html) { match ->
            val entryId = match.groupValues[1]
            val fileName = match.groupValues[2]
            if (!isSafeEntryId(entryId) || !isSafeFileName(fileName)) return@replace match.value
            fileToDataUri(File(entryDir(entryId), fileName)) ?: match.value
        }
        result = FILE_URI_REGEX.replace(result) { match ->
            val file = runCatching { File(Uri.parse(match.value).path.orEmpty()).canonicalFile }.getOrNull()
                ?: return@replace match.value
            if (!isUnderMediaRoot(file)) return@replace match.value
            fileToDataUri(file) ?: match.value
        }
        return result
    }

    fun referencedMediaFiles(html: String): List<File> {
        val files = linkedSetOf<File>()

        EDITOR_MEDIA_URI_REGEX.findAll(html).forEach { match ->
            val entryId = match.groupValues[1]
            val fileName = match.groupValues[2]
            if (isSafeEntryId(entryId) && isSafeFileName(fileName)) {
                val file = File(entryDir(entryId), fileName)
                if (file.isFile) files += file
            }
        }

        val rootPath = rootDir.canonicalPath + File.separator
        FILE_URI_REGEX.findAll(html).forEach { match ->
            val file = runCatching { File(Uri.parse(match.value).path.orEmpty()) }.getOrNull() ?: return@forEach
            if (file.exists() && runCatching { file.canonicalPath.startsWith(rootPath) }.getOrDefault(false)) {
                files += file
            }
        }

        return files.toList()
    }

    fun toBackupHtml(html: String): String {
        var result = EDITOR_MEDIA_URI_REGEX.replace(html) { match ->
            "media/${match.groupValues[1]}/${match.groupValues[2]}"
        }
        val rootPath = rootDir.canonicalPath + File.separator
        result = FILE_URI_REGEX.replace(result) { match ->
            val file = runCatching { File(Uri.parse(match.value).path.orEmpty()) }.getOrNull()
                ?: return@replace match.value
            val canonicalPath = runCatching { file.canonicalPath }.getOrNull() ?: return@replace match.value
            if (!canonicalPath.startsWith(rootPath)) return@replace match.value
            "media/${file.parentFile?.name.orEmpty()}/${file.name}"
        }
        return result
    }

    fun restoreBackupHtml(html: String): String {
        return BACKUP_MEDIA_REGEX.replace(html) { match ->
            val entryId = match.groupValues[1]
            val fileName = match.groupValues[2]
            if (!isSafeEntryId(entryId) || !isSafeFileName(fileName)) return@replace match.value
            editorMediaUri(entryId, fileName)
        }
    }

    private fun fileToDataUri(file: File): String? {
        if (!file.isFile) return null
        val bytes = runCatching { file.readBytes() }.getOrNull() ?: return null
        if (bytes.isEmpty()) return null
        val mime = mimeTypeForExtension(file.extension)
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return "data:$mime;base64,$encoded"
    }

    private fun isUnderMediaRoot(file: File): Boolean {
        val mediaRoot = runCatching { rootDir.canonicalFile }.getOrNull() ?: return false
        val canonical = runCatching { file.canonicalFile }.getOrNull() ?: return false
        return canonical.path == mediaRoot.path ||
            canonical.path.startsWith(mediaRoot.path + File.separator)
    }

    companion object {
        const val ROOT_DIR_NAME = "journal_media"
        const val EDITOR_MEDIA_SCHEME = "journal-media"
        private const val EDITOR_MEDIA_HOST = "local"

        private val DATA_IMAGE_REGEX =
            Regex("""data:image/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\r\n]+)""")
        private val FILE_URI_REGEX =
            Regex("""file://[^\s"'<>]+""")
        private val EDITOR_MEDIA_URI_REGEX =
            Regex("""journal-media://local/([^/"'<>]+)/([^"'<>]+)""")
        private val BACKUP_MEDIA_REGEX =
            Regex("""media/([^/"'<>]+)/([^"'<>]+)""")
        private val SAFE_ENTRY_ID_REGEX = Regex("[A-Za-z0-9_-]{1,128}")
        private val SAFE_FILE_NAME_REGEX = Regex("[A-Za-z0-9._-]{1,200}")

        fun File.toUriString(): String = Uri.fromFile(this).toString()

        fun editorMediaUri(entryId: String, fileName: String): String =
            "$EDITOR_MEDIA_SCHEME://$EDITOR_MEDIA_HOST/$entryId/$fileName"

        fun isSafeEntryId(entryId: String): Boolean = SAFE_ENTRY_ID_REGEX.matches(entryId)

        fun isSafeFileName(fileName: String): Boolean = SAFE_FILE_NAME_REGEX.matches(fileName)

        fun mimeTypeForExtension(extension: String): String = when (extension.lowercase()) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "svg" -> "image/svg+xml"
            else -> "application/octet-stream"
        }
    }
}
