package com.green.inorinal.backup

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.green.inorinal.data.Category
import com.green.inorinal.data.JournalEntry
import com.green.inorinal.data.Mood
import com.green.inorinal.data.Weather
import com.green.inorinal.media.JournalMediaStore
import java.io.BufferedInputStream
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

class JournalBackupManager(context: Context) {
    private val gson = Gson()
    private val mediaStore = JournalMediaStore(context)

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
        }
    }

    fun import(inputStream: InputStream): Pair<List<JournalEntry>, ImportResult> {
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

    private fun importZip(inputStream: InputStream): Pair<List<JournalEntry>, ImportResult> {
        val mediaBytes = mutableMapOf<String, ByteArray>()
        var manifestJson: String? = null

        ZipInputStream(inputStream.buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory) {
                    val bytes = zip.readBytes()
                    if (entry.name == MANIFEST_NAME) {
                        manifestJson = bytes.toString(Charsets.UTF_8)
                    } else if (entry.name.startsWith("media/")) {
                        mediaBytes[entry.name] = bytes
                    }
                }
                zip.closeEntry()
            }
        }

        val parsed = parseEntries(manifestJson.orEmpty())
        val entries = parsed.entries.map { parsedEntry ->
            mediaBytes
                .filterKeys { it.startsWith("media/${parsedEntry.id}/") }
                .forEach { (path, bytes) ->
                    val fileName = path.substringAfterLast('/')
                    mediaStore.entryDir(parsedEntry.id).resolve(fileName).writeBytes(bytes)
                }
            parsedEntry.copy(content = mediaStore.restoreBackupHtml(parsedEntry.content))
        }
        return entries to ImportResult(imported = entries.size, skipped = 0, failed = parsed.failed)
    }

    private fun importLegacyJson(inputStream: InputStream): Pair<List<JournalEntry>, ImportResult> {
        val json = inputStream.bufferedReader().use { it.readText() }
        val parsed = parseEntries(json)
        val entries = parsed.entries.map { entry ->
            entry.copy(content = mediaStore.migrateInlineImages(entry.id, entry.content))
        }
        return entries to ImportResult(imported = entries.size, skipped = 0, failed = parsed.failed)
    }

    private fun parseEntries(json: String): ParseResult {
        if (json.isBlank()) return ParseResult(emptyList(), failed = 1)
        val type = object : TypeToken<List<Map<String, Any?>>>() {}.type
        val rows: List<Map<String, Any?>> = runCatching<List<Map<String, Any?>>> {
            gson.fromJson<List<Map<String, Any?>>>(json, type)
        }.getOrNull() ?: return ParseResult(emptyList(), failed = 1)

        var failed = 0
        val entries = rows.mapNotNull { row: Map<String, Any?> ->
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
        val id = row.stringValue("id").takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
        val title = row.stringValue("title").ifBlank { "未命名日记" }
        val content = row.stringValue("content")
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

    companion object {
        private const val MANIFEST_NAME = "manifest.json"
    }
}
