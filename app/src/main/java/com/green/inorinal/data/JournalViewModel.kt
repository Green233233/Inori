package com.green.inorinal.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class JournalViewModel(application: Application) : AndroidViewModel(application) {

    private val dao = JournalDatabase.getDatabase(application).journalDao()
    private val repository = JournalRepository(dao)
    private val gson = Gson()

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
    suspend fun saveEntry(entry: JournalEntry): JournalEntry {
        val savedEntry = entry.copy(updatedAt = System.currentTimeMillis())
        repository.insert(savedEntry)
        refreshStats()
        return savedEntry
    }

    fun deleteEntry(entry: JournalEntry) {
        viewModelScope.launch {
            repository.delete(entry)
            refreshStats()
        }
    }

    suspend fun getEntryById(id: String): JournalEntry? {
        return repository.getEntryById(id)
    }

    fun toggleFavorite(entry: JournalEntry) {
        viewModelScope.launch {
            repository.toggleFavorite(entry)
            refreshStats()
        }
    }

    fun exportEntries(entries: List<JournalEntry>): String {
        val exportData = entries.map { entry ->
            mapOf(
                "id" to entry.id,
                "title" to entry.title,
                "content" to entry.content,
                "date" to entry.date.format(DateTimeFormatter.ISO_LOCAL_DATE),
                "weather" to entry.weather.name,
                "mood" to entry.mood.name,
                "category" to entry.category.name,
                "isFavorite" to entry.isFavorite,
                "imageUrl" to entry.imageUrl,
                "createdAt" to entry.createdAt,
                "updatedAt" to entry.updatedAt
            )
        }
        return gson.toJson(exportData)
    }

    fun importEntries(json: String, overwrite: Boolean = false) {
        val type = object : TypeToken<List<Map<String, Any>>>() {}.type
        val entriesData: List<Map<String, Any>> = gson.fromJson(json, type)
        viewModelScope.launch {
            for (data in entriesData) {
                val entry = JournalEntry(
                    id = data["id"] as String,
                    title = data["title"] as String,
                    content = data["content"] as String,
                    date = LocalDate.parse(data["date"] as String, DateTimeFormatter.ISO_LOCAL_DATE),
                    weather = Weather.valueOf(data["weather"] as String),
                    mood = Mood.valueOf(data["mood"] as String),
                    category = Category.valueOf(data["category"] as String),
                    isFavorite = data["isFavorite"] as? Boolean ?: false,
                    imageUrl = data["imageUrl"] as? String,
                    createdAt = (data["createdAt"] as? Double)?.toLong() ?: System.currentTimeMillis(),
                    updatedAt = (data["updatedAt"] as? Double)?.toLong() ?: System.currentTimeMillis()
                )
                if (overwrite) {
                    repository.insert(entry)
                } else {
                    val existing = repository.getEntryById(entry.id)
                    if (existing == null) {
                        repository.insert(entry)
                    }
                }
            }
            refreshStats()
        }
    }
}
