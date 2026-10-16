package dev.hexes.android.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "hexes_settings")

enum class ThemeChoice { System, Dark, Light }

/** The saved server address, token and theme. Lives in the app's private storage. */
class SettingsRepository(private val context: Context) {
    private object Keys {
        val url = stringPreferencesKey("server_url")
        val token = stringPreferencesKey("token")
        val theme = stringPreferencesKey("theme")
    }

    /** The saved connection, or null before first setup. */
    val connection: Flow<Connection?> = context.dataStore.data.map { prefs ->
        prefs[Keys.url]?.let { Connection.parse(it, prefs[Keys.token].orEmpty()) }
    }

    /** The saved fields exactly as typed, for pre-filling the settings form. */
    val rawFields: Flow<Pair<String, String>> = context.dataStore.data.map { prefs ->
        (prefs[Keys.url] ?: "") to (prefs[Keys.token] ?: "")
    }

    val theme: Flow<ThemeChoice> = context.dataStore.data.map(::themeOf)

    suspend fun saveConnection(url: String, token: String) {
        context.dataStore.edit {
            it[Keys.url] = url.trim()
            it[Keys.token] = token.trim()
        }
    }

    suspend fun clearConnection() {
        context.dataStore.edit {
            it.remove(Keys.url)
            it.remove(Keys.token)
        }
    }

    suspend fun saveTheme(choice: ThemeChoice) {
        context.dataStore.edit { it[Keys.theme] = choice.name }
    }

    private fun themeOf(prefs: Preferences): ThemeChoice =
        prefs[Keys.theme]?.let { name -> ThemeChoice.entries.firstOrNull { it.name == name } }
            ?: ThemeChoice.Dark
}
