package com.green.inorinal

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.green.inorinal.data.AppColorStyle
import com.green.inorinal.data.AppThemeMode
import com.green.inorinal.debug.DebugLog
import com.green.inorinal.navigation.AppNavigation
import com.green.inorinal.ui.theme.InorinalTheme
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val colorStyleKey = stringPreferencesKey("color_style")
        val themeModeKey = stringPreferencesKey("theme_mode")
        val fontSizeKey = intPreferencesKey("font_size")
        val debugModeKey = booleanPreferencesKey("debug_mode")

        // 尽早读取并初始化调试日志，确保崩溃捕获从启动阶段即生效。
        val initialDebugMode = runBlocking {
            applicationContext.dataStore.data.map { prefs -> prefs[debugModeKey] ?: false }.first()
        }
        DebugLog.init(applicationContext, initialDebugMode)

        setContent {
            var currentColorStyle by remember { mutableStateOf(AppColorStyle.SAKURA) }
            var currentThemeMode by remember { mutableStateOf(AppThemeMode.SYSTEM) }
            var currentFontSize by remember { mutableIntStateOf(16) }
            var currentDebugMode by remember { mutableStateOf(initialDebugMode) }

            LaunchedEffect(Unit) {
                val savedStyle = applicationContext.dataStore.data.map { prefs ->
                    val name = prefs[colorStyleKey] ?: AppColorStyle.SAKURA.name
                    try { AppColorStyle.valueOf(name) } catch (_: Exception) { AppColorStyle.SAKURA }
                }.first()
                currentColorStyle = savedStyle

                val savedMode = applicationContext.dataStore.data.map { prefs ->
                    val name = prefs[themeModeKey] ?: AppThemeMode.SYSTEM.name
                    try { AppThemeMode.valueOf(name) } catch (_: Exception) { AppThemeMode.SYSTEM }
                }.first()
                currentThemeMode = savedMode

                currentFontSize = applicationContext.dataStore.data.map { prefs ->
                    prefs[fontSizeKey] ?: 16
                }.first()
            }

            InorinalTheme(
                colorStyle = currentColorStyle,
                themeMode = currentThemeMode
            ) {
                AppNavigation(
                    colorStyle = currentColorStyle,
                    themeMode = currentThemeMode,
                    fontSizeSp = currentFontSize,
                    debugMode = currentDebugMode,
                    onColorStyleChange = { style ->
                        currentColorStyle = style
                        runBlocking {
                            applicationContext.dataStore.edit { prefs ->
                                prefs[colorStyleKey] = style.name
                            }
                        }
                    },
                    onThemeModeChange = { mode ->
                        currentThemeMode = mode
                        runBlocking {
                            applicationContext.dataStore.edit { prefs ->
                                prefs[themeModeKey] = mode.name
                            }
                        }
                    },
                    onFontSizeChange = { fontSize ->
                        currentFontSize = fontSize
                        runBlocking {
                            applicationContext.dataStore.edit { prefs ->
                                prefs[fontSizeKey] = fontSize
                            }
                        }
                    },
                    onDebugModeChange = { debugMode ->
                        currentDebugMode = debugMode
                        DebugLog.setEnabled(debugMode)
                        runBlocking {
                            applicationContext.dataStore.edit { prefs ->
                                prefs[debugModeKey] = debugMode
                            }
                        }
                    }
                )
            }
        }
    }
}
