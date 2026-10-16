package dev.hexes.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.data.ApiClient
import dev.hexes.android.data.ProjectSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface HomeUiState {
    data object Loading : HomeUiState
    data class Failed(val message: String) : HomeUiState
    data class Ready(val workspace: String?, val projects: List<ProjectSummary>) : HomeUiState
}

class HomeViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = HomeUiState.Loading
        viewModelScope.launch {
            val connection = container.settings.connection.first()
            if (connection == null) {
                _state.value = HomeUiState.Failed("No server is set up yet.")
                return@launch
            }
            _state.value = runCatching {
                val client = ApiClient(connection)
                HomeUiState.Ready(client.state().dir, client.projects())
            }.getOrElse { HomeUiState.Failed(it.message ?: "Could not load projects.") }
        }
    }
}
