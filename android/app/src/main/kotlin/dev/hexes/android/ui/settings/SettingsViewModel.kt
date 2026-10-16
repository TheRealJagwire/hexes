package dev.hexes.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.data.ApiClient
import dev.hexes.android.data.ApiException
import dev.hexes.android.data.Connection
import dev.hexes.android.data.PairingLink
import dev.hexes.android.data.ThemeChoice
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface ConnectState {
    data object Idle : ConnectState
    data object Connecting : ConnectState
    data class Failed(val message: String) : ConnectState
    /** Connected and saved; the screen navigates away once it sees this. */
    data class Connected(val summary: String) : ConnectState
}

data class SettingsUiState(
    val url: String = "",
    val token: String = "",
    val theme: ThemeChoice = ThemeChoice.Dark,
    val connect: ConnectState = ConnectState.Idle,
)

class SettingsViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val (url, token) = container.settings.rawFields.first()
            _state.update { it.copy(url = url, token = token, theme = container.settings.theme.first()) }
        }
        viewModelScope.launch {
            container.pendingPairing.collect { link ->
                if (link != null) {
                    apply(link)
                    container.pendingPairing.value = null
                }
            }
        }
    }

    fun onUrlChange(text: String) {
        // Pasting the whole pairing link into the address field fills in both fields.
        val link = PairingLink.parse(text)
        if (link != null) apply(link) else _state.update { it.copy(url = text, connect = ConnectState.Idle) }
    }

    fun onTokenChange(text: String) = _state.update { it.copy(token = text, connect = ConnectState.Idle) }

    fun onThemeChange(choice: ThemeChoice) {
        _state.update { it.copy(theme = choice) }
        viewModelScope.launch { container.settings.saveTheme(choice) }
    }

    private fun apply(link: PairingLink) =
        _state.update { it.copy(url = link.url, token = link.token, connect = ConnectState.Idle) }

    /** Checks the server and, only if that works, saves the address and token. */
    fun connect() {
        val current = _state.value
        val connection = Connection.parse(current.url, current.token)
        if (connection == null) {
            _state.update { it.copy(connect = ConnectState.Failed("Enter the address of your Studio server.")) }
            return
        }
        _state.update { it.copy(connect = ConnectState.Connecting) }
        viewModelScope.launch {
            val result = runCatching {
                val client = ApiClient(connection)
                client.health()
                client.state()
            }
            result.onSuccess { workspace ->
                container.settings.saveConnection(current.url, current.token)
                val where = workspace.dir ?: "no workspace open yet"
                _state.update { it.copy(connect = ConnectState.Connected("Connected · $where")) }
            }.onFailure { e ->
                _state.update { it.copy(connect = ConnectState.Failed(describe(e, connection))) }
            }
        }
    }

    private fun describe(e: Throwable, connection: Connection): String = when (e) {
        is ApiException.Unreachable ->
            "Can't reach ${connection.baseUrl}. Is Studio running, and is the address right?"
        is ApiException.Unauthorized ->
            if (connection.token.isEmpty()) "This server needs a token. Enter the one Studio printed."
            else "The server rejected the token."
        is ApiException.Http -> e.message ?: "The server returned an error (${e.status})."
        is ApiException -> e.message ?: "Could not connect."
        else -> e.message ?: "Could not connect."
    }
}
