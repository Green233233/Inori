package com.green.inorinal.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import java.time.LocalDate
import java.time.format.DateTimeFormatter

enum class Weather(val displayName: String) {
    SUNNY("晴天"),
    RAINY("雨天"),
    CLOUDY("阴天"),
    NIGHT_CLEAR("夜晚"),
    @Deprecated("Legacy value retained for database compatibility") SNOWY("雪天");

    fun normalized(): Weather = if (this == SNOWY) CLOUDY else this

    companion object {
        val selectableEntries = listOf(SUNNY, CLOUDY, RAINY, NIGHT_CLEAR)
    }
}

enum class Mood(val displayName: String) {
    HAPPY("开心"),
    CALM("无感"),
    SAD("伤心"),
    @Deprecated("Legacy value retained for database compatibility") EXCITED("兴奋"),
    @Deprecated("Legacy value retained for database compatibility") PROUD("自豪"),
    @Deprecated("Legacy value retained for database compatibility") EMOTIONAL("感动");

    fun normalized(): Mood = when (this) {
        EXCITED, PROUD -> HAPPY
        EMOTIONAL -> CALM
        else -> this
    }

    companion object {
        val selectableEntries = listOf(HAPPY, CALM, SAD)
    }
}
enum class Category { ALL, DAILY, WORK, GOAL, INSPIRATION, EMOTION }

/** 颜色风格：樱花粉 / 薄荷绿 / 长春花色 / 跟随系统动态取色 */
enum class AppColorStyle(val displayName: String) {
    SAKURA("樱花粉"),
    MINT("薄荷绿"),
    PERIWINKLE("长春花色"),
    SYSTEM("跟随系统")
}

/** 主题模式：浅色 / 深色 / 跟随系统 */
enum class AppThemeMode(val displayName: String) {
    LIGHT("浅色"),
    DARK("深色"),
    SYSTEM("跟随系统")
}

@Entity(tableName = "journal_entries")
data class JournalEntry(
    @PrimaryKey val id: String,
    val title: String,
    val content: String,
    val date: LocalDate,
    val weather: Weather,
    val mood: Mood,
    val category: Category,
    val isFavorite: Boolean = false,
    val imageUrl: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

class Converters {
    private val dateFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    @TypeConverter
    fun fromLocalDate(date: LocalDate?): String? = date?.format(dateFormatter)

    @TypeConverter
    fun toLocalDate(value: String?): LocalDate? = value?.let { LocalDate.parse(it, dateFormatter) }

    @TypeConverter
    fun fromWeather(weather: Weather?): String? = weather?.normalized()?.name

    @TypeConverter
    fun toWeather(value: String?): Weather =
        runCatching { Weather.valueOf(value.orEmpty()).normalized() }.getOrDefault(Weather.SUNNY)

    @TypeConverter
    fun fromMood(mood: Mood?): String? = mood?.normalized()?.name

    @TypeConverter
    fun toMood(value: String?): Mood =
        runCatching { Mood.valueOf(value.orEmpty()).normalized() }.getOrDefault(Mood.HAPPY)

    @TypeConverter
    fun fromCategory(category: Category?): String? = category?.name

    @TypeConverter
    fun toCategory(value: String?): Category =
        runCatching { Category.valueOf(value.orEmpty()) }.getOrDefault(Category.DAILY)
}
