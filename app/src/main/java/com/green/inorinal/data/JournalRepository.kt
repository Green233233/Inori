package com.green.inorinal.data

import kotlinx.coroutines.flow.Flow
import java.time.LocalDate

class JournalRepository(private val journalDao: JournalDao) {
    private companion object {
        const val CONTENT_CHUNK_SIZE = 512_000
    }

    fun getAllEntries(): Flow<List<JournalEntry>> = journalDao.getAllEntries()

    suspend fun getEntryById(id: String): JournalEntry? {
        val metadata = journalDao.getEntryMetadataById(id) ?: return null
        val contentLength = journalDao.getEntryContentLength(id) ?: 0
        if (contentLength <= 0) return metadata

        val content = buildString(contentLength) {
            var start = 1
            while (start <= contentLength) {
                append(journalDao.getEntryContentChunk(id, start, CONTENT_CHUNK_SIZE).orEmpty())
                start += CONTENT_CHUNK_SIZE
            }
        }
        return metadata.copy(content = content)
    }

    fun getFavoriteEntries(): Flow<List<JournalEntry>> = journalDao.getFavoriteEntries()

    fun getEntriesByCategory(category: Category): Flow<List<JournalEntry>> =
        journalDao.getEntriesByCategory(category)

    fun searchEntries(query: String): Flow<List<JournalEntry>> = journalDao.searchEntries(query)

    suspend fun getTotalCount(): Int = journalDao.getTotalCount()

    suspend fun getMonthCount(): Int = journalDao.getMonthCount(LocalDate.now().withDayOfMonth(1))

    suspend fun getFavoriteCount(): Int = journalDao.getFavoriteCount()

    suspend fun getAllEntryDates(): List<LocalDate> = journalDao.getAllEntryDates()

    suspend fun getAllEntryIds(): List<String> = journalDao.getAllEntryIds()

    suspend fun insert(entry: JournalEntry) = journalDao.insert(entry)

    suspend fun insertAll(entries: List<JournalEntry>) {
        if (entries.isNotEmpty()) journalDao.insertAll(entries)
    }

    suspend fun update(entry: JournalEntry) = journalDao.update(entry)

    suspend fun delete(entry: JournalEntry) = journalDao.delete(entry)

    suspend fun toggleFavorite(entry: JournalEntry) {
        journalDao.updateFavorite(
            id = entry.id,
            isFavorite = !entry.isFavorite,
            updatedAt = System.currentTimeMillis()
        )
    }

    /** 计算连续写日记天数（从今天往回数） */
    suspend fun getStreakCount(): Int {
        val dates = getAllEntryDates().toSet()
        if (dates.isEmpty()) return 0

        var streak = 0
        var checkDate = LocalDate.now()

        // 如果今天没有写，从昨天开始检查
        if (checkDate !in dates) {
            checkDate = checkDate.minusDays(1)
        }

        while (checkDate in dates) {
            streak++
            checkDate = checkDate.minusDays(1)
        }

        return streak
    }
}
