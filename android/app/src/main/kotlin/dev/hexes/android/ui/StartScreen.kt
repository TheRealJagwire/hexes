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
import dev.hexes.android.data.ProjectSummary
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.SecondaryButton

class StartViewModel(container: AppContainer) : ViewModel() {
    val state = ResourceLoader(viewModelScope, kotlinx.coroutines.flow.MutableStateFlow(0)) { container.api().projects() }
    fun retry() = state.refresh()
}

/** `/`: the project list, or welcome when the server has no projects yet. Nothing is "selected". */
@Composable
fun StartScreen(onGo: (String) -> Unit, onSettings: () -> Unit) {
    val vm = containerViewModel { StartViewModel(it) }
    val res by vm.state.state.collectAsStateWithLifecycle()
    LaunchedEffect(res) {
        (res as? Resource.Ready<List<ProjectSummary>>)?.data?.let { projects ->
            onGo(if (projects.isEmpty()) Routes.Welcome else Routes.Projects)
        }
    }
    when (val r = res) {
        is Resource.Failed -> ErrorState(r.message, onRetry = vm::retry) {
            SecondaryButton("Settings", onSettings)
        }
        else -> LoadingState()
    }
}
