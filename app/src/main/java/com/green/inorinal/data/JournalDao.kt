package com.green.inorinal.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate

@Dao
interface JournalDao {
    @Query("SELECT id, title, substr(content, 1, 500) AS content, date, weather, mood, category, isFavorite, imageUrl, createdAt, updatedAt FROM journal_entries ORDER BY createdAt DESC")
    fun getAllEntries(): Flow<List<JournalEntry>>

    @Query("SELECT id, title, '' AS content, date, weather, mood, category, isFavorite, imageUrl, createdAt, updatedAt FROM journal_entries WHERE id = :id")
    suspend fun getEntryMetadataById(id: String): JournalEntry?

    @Query("SELECT length(content) FROM journal_entries WHERE id = :id")
    suspend fun getEntryContentLength(id: String): Int?

    @Query("SELECT substr(content, :start, :length) FROM journal_entries WHERE id = :id")
    suspend fun getEntryContentChunk(id: String, start: Int, length: Int): String?

    @Query("SELECT id, title, substr(content, 1, 500) AS content, date, weather, mood, category, isFavorite, imageUrl, createdAt, updatedAt FROM journal_entries WHERE isFavorite = 1 ORDER BY createdAt DESC")
    fun getFavoriteEntries(): Flow<List<JournalEntry>>

    @Query("SELECT id, title, substr(content, 1, 500) AS content, date, weather, mood, category, isFavorite, imageUrl, createdAt, updatedAt FROM journal_entries WHERE category = :category ORDER BY createdAt DESC")
    fun getEntriesByCategory(category: Category): Flow<List<JournalEntry>>

    @Query("SELECT id, title, substr(content, 1, 500) AS content, date, weather, mood, category, isFavorite, imageUrl, createdAt, updatedAt FROM journal_entries WHERE title LIKE '%' || :query || '%' OR content LIKE '%' || :query || '%' ORDER BY createdAt DESC")
    fun searchEntries(query: String): Flow<List<JournalEntry>>

    @Query("SELECT COUNT(*) FROM journal_entries")
    suspend fun getTotalCount(): Int

    @Query("SELECT COUNT(*) FROM journal_entries WHERE date >= :startOfMonth")
    suspend fun getMonthCount(startOfMonth: LocalDate): Int

    @Query("SELECT COUNT(*) FROM journal_entries WHERE isFavorite = 1")
    suspend fun getFavoriteCount(): Int

    @Query("SELECT DISTINCT date FROM journal_entries ORDER BY date DESC")
    suspend fun getAllEntryDates(): List<LocalDate>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: JournalEntry)

    @Update
    suspend fun update(entry: JournalEntry)

    @Delete
    suspend fun delete(entry: JournalEntry)

    @Query("UPDATE journal_entries SET isFavorite = :isFavorite, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateFavorite(id: String, isFavorite: Boolean, updatedAt: Long)

    @Query("DELETE FROM journal_entries WHERE id = :id")
    suspend fun deleteById(id: String)
}
