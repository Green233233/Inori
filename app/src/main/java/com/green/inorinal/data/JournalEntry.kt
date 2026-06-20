package com.green.inorinal.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import java.time.LocalDate
import java.time.format.DateTimeFormatter

enum class Weather { SUNNY, RAINY, CLOUDY, NIGHT_CLEAR, SNOWY }
enum class Mood { HAPPY, CALM, EXCITED, PROUD, EMOTIONAL, SAD }
enum class Category { ALL, DAILY, WORK, GOAL, INSPIRATION, EMOTION }

/** 颜色风格：樱花粉 / 薄荷绿 / 跟随系统动态取色 */
enum class AppColorStyle(val displayName: String) {
    SAKURA("樱花粉"),
    MINT("薄荷绿"),
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
    fun fromWeather(weather: Weather?): String? = weather?.name

    @TypeConverter
    fun toWeather(value: String?): Weather? = value?.let { Weather.valueOf(it) }

    @TypeConverter
    fun fromMood(mood: Mood?): String? = mood?.name

    @TypeConverter
    fun toMood(value: String?): Mood? = value?.let { Mood.valueOf(it) }

    @TypeConverter
    fun fromCategory(category: Category?): String? = category?.name

    @TypeConverter
    fun toCategory(value: String?): Category? = value?.let { Category.valueOf(it) }
}
