package com.green.inorinal

import java.time.LocalDate

data class JournalEntry(
    val id: String,
    val title: String,
    val content: String,
    val date: LocalDate,
    val weather: String,
    val mood: String,
    val imageUrl: String? = null
)
