package com.green.inorinal

import com.green.inorinal.data.Category
import com.green.inorinal.data.Converters
import com.green.inorinal.data.Mood
import com.green.inorinal.data.Weather
import org.junit.Test

import org.junit.Assert.*

class ExampleUnitTest {
    private val converters = Converters()

    @Test
    fun legacyWeatherValuesAreNormalized() {
        assertEquals(Weather.CLOUDY, converters.toWeather("SNOWY"))
        assertEquals("CLOUDY", converters.fromWeather(Weather.SNOWY))
    }

    @Test
    fun legacyMoodValuesAreNormalized() {
        assertEquals(Mood.HAPPY, converters.toMood("EXCITED"))
        assertEquals(Mood.HAPPY, converters.toMood("PROUD"))
        assertEquals(Mood.CALM, converters.toMood("EMOTIONAL"))
        assertEquals("CALM", converters.fromMood(Mood.EMOTIONAL))
    }

    @Test
    fun invalidCategoryFallsBackToDaily() {
        assertEquals(Category.DAILY, converters.toCategory("UNKNOWN"))
    }
}