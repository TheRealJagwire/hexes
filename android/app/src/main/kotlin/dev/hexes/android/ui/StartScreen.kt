package dev.hexes.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.containerViewModel
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.data.WorkspaceState
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.SecondaryButton

class StartViewModel(container: AppContainer) : ViewModel() {
    val state = ResourceLoader(viewModelScope, kotlinx.coroutines.flow.MutableStateFlow(0)) { container.api().state() }
    fun retry() = state.refresh()
}

/** `/`: no folder open → the workspace picker; a selected project → its screen; else the project list. */
@Composable
fun StartScreen(onGo: (String) -> Unit, onSettings: () -> Unit) {
    val vm = containerViewModel { StartViewModel(it) }
    val res by vm.state.state.collectAsStateWithLifecycle()
    LaunchedEffect(res) {
        (res as? Resource.Ready<WorkspaceState>)?.data?.let { s ->
            onGo(
                when {
                    s.dir == null -> Routes.Welcome
                    s.selectedProjectId != null -> Routes.project(s.selectedProjectId)
                    else -> Routes.Projects
                },
            )
        }
    }
    when (val r = res) {
        is Resource.Failed -> ErrorState(r.message, onRetry = vm::retry) {
            SecondaryButton("Settings", onSettings)
        }
        else -> LoadingState()
    }
}
