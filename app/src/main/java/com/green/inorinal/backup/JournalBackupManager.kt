package com.green.inorinal.backup

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.green.inorinal.data.Category
import com.green.inorinal.data.JournalEntry
import com.green.inorinal.data.Mood
import com.green.inorinal.data.Weather
import com.green.inorinal.media.JournalMediaStore
import com.green.inorinal.media.UserStickerStore
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

data class ImportResult(
    val imported: Int,
    val skipped: Int,
    val failed: Int
) {
    fun message(): String = "导入完成：新增 $imported 篇，跳过 $skipped 篇，失败 $failed 篇"
}

data class StagedBackupMedia(
    val entryId: String,
    val fileName: String,
    val file: File
)

data class StagedBackupSticker(
    val fileName: String,
    val file: File
)

data class ParsedBackup(
    val entries: List<JournalEntry>,
    val failed: Int,
    val stagedMedia: List<StagedBackupMedia>,
    val stagedStickers: List<StagedBackupSticker> = emptyList(),
    private val tempDir: File?
) {
    fun cleanup() {
        tempDir?.deleteRecursively()
    }

    fun stagedMediaFor(entryId: String): List<StagedBackupMedia> =
        stagedMedia.filter { it.entryId == entryId }
}

class JournalBackupManager(context: Context) {
    private val appContext = context.applicationContext
    private val gson = Gson()
    private val mediaStore = JournalMediaStore(appContext)
    private val userStickerStore = UserStickerStore(appContext)

    private data class ParseResult(
        val entries: List<JournalEntry>,
        val failed: Int
    )

    fun exportZip(entries: List<JournalEntry>, outputStream: OutputStream) {
        ZipOutputStream(outputStream.buffered()).use { zip ->
            val exportEntries = entries.map { entry ->
                entry.toExportMap(mediaStore.toBackupHtml(entry.content))
            }
            zip.putNextEntry(ZipEntry(MANIFEST_NAME))
            zip.write(gson.toJson(exportEntries).toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            entries
                .flatMap { mediaStore.referencedMediaFiles(it.content) }
                .distinctBy { it.canonicalPath }
                .forEach { file ->
                    val entryName = "media/${file.parentFile?.name.orEmpty()}/${file.name}"
                    zip.putNextEntry(ZipEntry(entryName))
                    file.inputStream().use { it.copyTo(zip) }
                    zip.closeEntry()
                }

            userStickerStore.allFilesForExport().forEach { file ->
                zip.putNextEntry(ZipEntry("stickers/${file.name}"))
                file.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
    }

    fun import(inputStream: InputStream): ParsedBackup {
        val buffered = BufferedInputStream(inputStream)
        buffered.mark(4)
        val signature = ByteArray(2)
        val count = buffered.read(signature)
        buffered.reset()

        return if (count == 2 && signature[0] == 'P'.code.toByte() && signature[1] == 'K'.code.toByte()) {
            importZip(buffered)
        } else {
            importLegacyJson(buffered)
        }
    }

    private fun importZip(inputStream: InputStream): ParsedBackup {
        val tempDir = File(appContext.cacheDir, "journal_backup_import_${System.currentTimeMillis()}")
            .also { it.mkdirs() }
        val stagedMedia = mutableListOf<StagedBackupMedia>()
        val stagedStickers = mutableListOf<StagedBackupSticker>()
        var manifestJson: String? = null
        var mediaTotalBytes = 0L
        var fileCount = 0

        try {
            ZipInputStream(inputStream.buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (!entry.isDirectory) {
                        fileCount++
                        require(fileCount <= MAX_ARCHIVE_FILES) { "Backup contains too many files" }
                        when {
                            entry.name == MANIFEST_NAME -> {
                                manifestJson = readLimited(zip, MAX_MANIFEST_BYTES).toString(Charsets.UTF_8)
                            }
                            isSafeMediaPath(entry.name) -> {
                                val bytes = readLimited(zip, MAX_MEDIA_FILE_BYTES)
                                mediaTotalBytes += bytes.size
                                require(mediaTotalBytes <= MAX_TOTAL_MEDIA_BYTES) { "Backup media is too large" }
                                val entryId = entry.name.substringAfter("media/").substringBefore('/')
                                val fileName = entry.name.substringAfterLast('/')
                                val target = File(File(tempDir, entryId).also { it.mkdirs() }, fileName)
                                target.writeBytes(bytes)
                                stagedMedia += StagedBackupMedia(entryId, fileName, target)
                            }
                            isSafeStickerPath(entry.name) -> {
                                val bytes = readLimited(zip, MAX_STICKER_FILE_BYTES)
                                mediaTotalBytes += bytes.size
                                require(mediaTotalBytes <= MAX_TOTAL_MEDIA_BYTES) { "Backup media is too large" }
                                val fileName = entry.name.substringAfterLast('/')
                                val stickerDir = File(tempDir, "stickers").also { it.mkdirs() }
                                val target = File(stickerDir, fileName)
                                target.writeBytes(bytes)
                                stagedStickers += StagedBackupSticker(fileName, target)
                            }
                        }
                    }
                    zip.closeEntry()
                }
            }

            val parsed = parseEntries(manifestJson.orEmpty())
            return ParsedBackup(
                entries = parsed.entries,
                failed = parsed.failed,
                stagedMedia = stagedMedia,
                stagedStickers = stagedStickers,
                tempDir = tempDir
            )
        } catch (throwable: Throwable) {
            tempDir.deleteRecursively()
            throw throwable
        }
    }

    private fun importLegacyJson(inputStream: InputStream): ParsedBackup {
        val json = readLimited(inputStream, MAX_MANIFEST_BYTES).toString(Charsets.UTF_8)
        val parsed = parseEntries(json)
        return ParsedBackup(
            entries = parsed.entries,
            failed = parsed.failed,
            stagedMedia = emptyList(),
            tempDir = null
        )
    }

    private fun parseEntries(json: String): ParseResult {
        if (json.isBlank()) return ParseResult(emptyList(), failed = 1)
        val type = object : TypeToken<List<Map<String, Any?>>>() {}.type
        val rows: List<Map<String, Any?>> = runCatching<List<Map<String, Any?>>> {
            gson.fromJson<List<Map<String, Any?>>>(json, type)
        }.getOrNull() ?: return ParseResult(emptyList(), failed = 1)

        var failed = (rows.size - MAX_BACKUP_ENTRIES).coerceAtLeast(0)
        val entries = rows.take(MAX_BACKUP_ENTRIES).mapNotNull { row: Map<String, Any?> ->
            val parsedEntry = parseEntry(row)
            if (parsedEntry == null) {
                failed++
                null
            } else {
                parsedEntry
            }
        }
        return ParseResult(entries, failed)
    }

    private fun parseEntry(row: Map<String, Any?>): JournalEntry? {
        val rawId = row.stringValue("id")
        val id = if (rawId.isBlank()) UUID.randomUUID().toString() else rawId
        if (!JournalMediaStore.isSafeEntryId(id)) return null
        val title = row.stringValue("title").ifBlank { "未命名日记" }.take(MAX_TITLE_LENGTH)
        val content = row.stringValue("content")
        if (content.length > MAX_ENTRY_CONTENT_LENGTH) return null
        val date = runCatching {
            LocalDate.parse(row.stringValue("date"), DateTimeFormatter.ISO_LOCAL_DATE)
        }.getOrDefault(LocalDate.now())

        return runCatching {
            JournalEntry(
                id = id,
                title = title,
                content = content,
                date = date,
                weather = enumValue(row.stringValue("weather"), Weather.SUNNY),
                mood = enumValue(row.stringValue("mood"), Mood.HAPPY),
                category = enumValue(row.stringValue("category"), Category.DAILY),
                isFavorite = row["isFavorite"] as? Boolean ?: false,
                imageUrl = row.stringValue("imageUrl").ifBlank { null },
                createdAt = row.longValue("createdAt") ?: System.currentTimeMillis(),
                updatedAt = row.longValue("updatedAt") ?: System.currentTimeMillis()
            )
        }.getOrNull()
    }

    private fun JournalEntry.toExportMap(contentForBackup: String): Map<String, Any?> = mapOf(
        "id" to id,
        "title" to title,
        "content" to contentForBackup,
        "date" to date.format(DateTimeFormatter.ISO_LOCAL_DATE),
        "weather" to weather.name,
        "mood" to mood.name,
        "category" to category.name,
        "isFavorite" to isFavorite,
        "imageUrl" to imageUrl,
        "createdAt" to createdAt,
        "updatedAt" to updatedAt
    )

    private fun Map<String, Any?>.stringValue(key: String): String {
        return when (val value = this[key]) {
            null -> ""
            is String -> value
            else -> value.toString()
        }
    }

    private fun Map<String, Any?>.longValue(key: String): Long? {
        return when (val value = this[key]) {
            is Number -> value.toLong()
            is String -> value.toLongOrNull()
            else -> null
        }
    }

    private inline fun <reified T : Enum<T>> enumValue(name: String, default: T): T {
        return runCatching { enumValueOf<T>(name) }.getOrDefault(default)
    }

    private fun isSafeMediaPath(path: String): Boolean {
        val parts = path.split('/')
        return parts.size == 3 &&
            parts[0] == "media" &&
            JournalMediaStore.isSafeEntryId(parts[1]) &&
            parts[2].matches(SAFE_FILE_NAME_REGEX) &&
            parts[2] != "." &&
            parts[2] != ".."
    }

    private fun isSafeStickerPath(path: String): Boolean {
        val parts = path.split('/')
        return parts.size == 2 &&
            parts[0] == "stickers" &&
            UserStickerStore.isSafeFileName(parts[1])
    }

    private fun readLimited(input: InputStream, maxBytes: Int): ByteArray {
        val output = ByteArrayOutputStream(minOf(maxBytes, DEFAULT_BUFFER_SIZE))
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            require(total <= maxBytes) { "Backup entry is too large" }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    companion object {
        private const val MANIFEST_NAME = "manifest.json"
        private const val MAX_ARCHIVE_FILES = 5_000
        private const val MAX_BACKUP_ENTRIES = 10_000
        private const val MAX_MANIFEST_BYTES = 16 * 1024 * 1024
        private const val MAX_MEDIA_FILE_BYTES = 20 * 1024 * 1024
        private const val MAX_STICKER_FILE_BYTES = 512 * 1024
        private const val MAX_TOTAL_MEDIA_BYTES = 128L * 1024 * 1024
        private const val MAX_TITLE_LENGTH = 500
        private const val MAX_ENTRY_CONTENT_LENGTH = 10_000_000
        private val SAFE_FILE_NAME_REGEX = Regex("[A-Za-z0-9._-]{1,255}")
    }
}
