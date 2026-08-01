package com.green.inorinal

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.green.inorinal.backup.JournalBackupManager
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BackupImportInstrumentedTest {
    @Test
    fun zipImportStagesMediaWithoutWritingFormalMediaDirectory() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val entryId = "p0test${System.currentTimeMillis()}"
        val manager = JournalBackupManager(context)
        val backupBytes = createBackupZip(entryId)
        val formalMedia = File(context.filesDir, "journal_media/$entryId/image.jpg")

        val parsedBackup = manager.import(ByteArrayInputStream(backupBytes))
        try {
            assertEquals(1, parsedBackup.entries.size)
            assertTrue(parsedBackup.stagedMediaFor(entryId).isNotEmpty())
            assertFalse(formalMedia.exists())
        } finally {
            parsedBackup.cleanup()
            File(context.filesDir, "journal_media/$entryId").deleteRecursively()
        }
    }

    private fun createBackupZip(entryId: String): ByteArray {
        val manifest = """
            [
              {
                "id": "$entryId",
                "title": "P0 test",
                "content": "<img src=\"media/$entryId/image.jpg\">",
                "date": "2026-08-01",
                "weather": "SUNNY",
                "mood": "HAPPY",
                "category": "DAILY",
                "isFavorite": false,
                "createdAt": 1,
                "updatedAt": 1
              }
            ]
        """.trimIndent()

        return ByteArrayOutputStream().use { output ->
            ZipOutputStream(output).use { zip ->
                zip.putNextEntry(ZipEntry("manifest.json"))
                zip.write(manifest.toByteArray(Charsets.UTF_8))
                zip.closeEntry()

                zip.putNextEntry(ZipEntry("media/$entryId/image.jpg"))
                zip.write(byteArrayOf(1, 2, 3, 4))
                zip.closeEntry()
            }
            output.toByteArray()
        }
    }
}
