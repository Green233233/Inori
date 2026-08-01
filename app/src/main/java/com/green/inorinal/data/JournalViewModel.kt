package com.green.inorinal.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.green.inorinal.backup.ImportResult
import com.green.inorinal.backup.JournalBackupManager
import com.green.inorinal.media.JournalMediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.io.OutputStream
import java.time.LocalDate
import java.util.UUID

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class JournalViewModel(application: Application) : AndroidViewModel(application) {

    private val dao = JournalDatabase.getDatabase(application).journalDao()
    private val repository = JournalRepository(dao)
    private val mediaStore = JournalMediaStore(application)
    private val backupManager = JournalBackupManager(application)

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _entriesLoaded = MutableStateFlow(false)
    val entriesLoaded: StateFlow<Boolean> = _entriesLoaded.asStateFlow()

    val allEntries: StateFlow<List<JournalEntry>> = repository.getAllEntries()
        .onEach { _entriesLoaded.value = true }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val favoriteEntries: StateFlow<List<JournalEntry>> = repository.getFavoriteEntries()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val searchResults: StateFlow<List<JournalEntry>> = _searchQuery
        .flatMapLatest { query ->
            if (query.isBlank()) repository.getAllEntries()
            else repository.searchEntries(query)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _selectedCategory = MutableStateFlow(Category.ALL)
    val selectedCategory: StateFlow<Category> = _selectedCategory.asStateFlow()

    val categoryEntries: StateFlow<List<JournalEntry>> = _selectedCategory
        .flatMapLatest { category ->
            if (category == Category.ALL) repository.getAllEntries()
            else repository.getEntriesByCategory(category)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _totalCount = MutableStateFlow(0)
    val totalCount: StateFlow<Int> = _totalCount.asStateFlow()

    private val _monthCount = MutableStateFlow(0)
    val monthCount: StateFlow<Int> = _monthCount.asStateFlow()

    private val _favoriteCount = MutableStateFlow(0)
    val favoriteCount: StateFlow<Int> = _favoriteCount.asStateFlow()

    private val _streakCount = MutableStateFlow(0)
    val streakCount: StateFlow<Int> = _streakCount.asStateFlow()

    init {
        refreshStats()
    }

    private fun refreshStats() {
        viewModelScope.launch {
            _totalCount.value = repository.getTotalCount()
            _monthCount.value = repository.getMonthCount()
            _favoriteCount.value = repository.getFavoriteCount()
            _streakCount.value = repository.getStreakCount()
        }
    }

    fun setSearchQuery(query: String) {
        _searchQuery.value = query
    }

    fun selectCategory(category: Category) {
        _selectedCategory.value = category
    }

    fun createEntry(
        title: String? = null,
        weather: Weather = Weather.SUNNY,
        mood: Mood = Mood.HAPPY,
        category: Category = Category.DAILY
    ): JournalEntry {
        val now = LocalDate.now()
        val dayOfWeek = when (now.dayOfWeek.value) {
            1 -> "星期一"; 2 -> "星期二"; 3 -> "星期三"
            4 -> "星期四"; 5 -> "星期五"; 6 -> "星期六"; 7 -> "星期日"; else -> ""
        }
        val defaultTitle = title ?: "${now.year}年${now.monthValue}月${now.dayOfMonth}日 $dayOfWeek"
        val entry = JournalEntry(
            id = UUID.randomUUID().toString(),
            title = defaultTitle,
            content = "",
            date = now,
            weather = weather,
            mood = mood,
            category = category
        )
        viewModelScope.launch {
            repository.insert(entry)
            refreshStats()
        }
        return entry
    }

    fun updateEntry(entry: JournalEntry) {
        viewModelScope.launch {
            repository.update(entry.copy(updatedAt = System.currentTimeMillis()))
            refreshStats()
        }
    }

    /** 同步保存日记（供编辑器使用，在协程中调用） */
    suspend fun saveEntry(
        entry: JournalEntry,
        refreshStatistics: Boolean = false
    ): JournalEntry = withContext(Dispatchers.IO) {
        val migratedContent = mediaStore.migrateInlineImages(entry.id, entry.content)
        val savedEntry = entry.copy(content = migratedContent, updatedAt = System.currentTimeMillis())
        repository.insert(savedEntry)
        if (refreshStatistics) refreshStats()
        savedEntry
    }

    fun deleteEntry(entry: JournalEntry) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                repository.delete(entry)
                mediaStore.deleteEntryMedia(entry.id)
            }
            refreshStats()
        }
    }

    suspend fun getEntryById(id: String): JournalEntry? = withContext(Dispatchers.IO) {
        repository.getEntryById(id)?.let { entry ->
            val migratedContent = mediaStore.migrateInlineImages(entry.id, entry.content)
            if (migratedContent != entry.content) {
                val migrated = entry.copy(content = migratedContent, updatedAt = System.currentTimeMillis())
                repository.insert(migrated)
                migrated
            } else {
                entry
            }
        }
    }

    fun toggleFavorite(entry: JournalEntry) {
        viewModelScope.launch {
            repository.toggleFavorite(entry)
            refreshStats()
        }
    }

    suspend fun exportBackup(outputStream: OutputStream) {
        val fullEntries = repository.getAllEntryIds().mapNotNull { repository.getEntryById(it) }
        backupManager.exportZip(fullEntries, outputStream)
    }

    suspend fun importBackup(inputStream: InputStream, overwrite: Boolean = false): ImportResult {
        val parsedBackup = backupManager.import(inputStream)
        var imported = 0
        var skipped = 0
        var failed = parsedBackup.failed
        val entriesToImport = mutableListOf<JournalEntry>()

        try {
            parsedBackup.entries.forEach { entry ->
                runCatching {
                    val existing = repository.getEntryById(entry.id)
                    if (!overwrite && existing != null) {
                        skipped++
                        return@runCatching
                    }

                    parsedBackup.stagedMediaFor(entry.id).forEach { staged ->
                        val target = mediaStore.entryDir(entry.id).resolve(staged.fileName)
                        staged.file.copyTo(target, overwrite = true)
                    }

                    val restoredContent = if (parsedBackup.stagedMediaFor(entry.id).isNotEmpty()) {
                        mediaStore.restoreBackupHtml(entry.content)
                    } else {
                        entry.content
                    }
                    val migratedContent = mediaStore.migrateInlineImages(entry.id, restoredContent)
                    entriesToImport += entry.copy(content = migratedContent, updatedAt = System.currentTimeMillis())
                }.onFailure {
                    failed++
                }
            }

            runCatching {
                repository.insertAll(entriesToImport)
                imported = entriesToImport.size
            }.onFailure {
                failed += entriesToImport.size
                imported = 0
            }
        } finally {
            parsedBackup.cleanup()
        }

        refreshStats()
        return ImportResult(imported = imported, skipped = skipped, failed = failed)
    }
}
