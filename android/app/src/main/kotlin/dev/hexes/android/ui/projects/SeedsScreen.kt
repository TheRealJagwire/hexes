package dev.hexes.android.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.containerViewModel
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.data.SeedView
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.Panel
import dev.hexes.android.ui.components.TopBar
import dev.hexes.android.ui.components.readable
import dev.hexes.android.ui.theme.Hexes

class SeedsViewModel(private val container: AppContainer) : ViewModel() {
    val seeds = ResourceLoader(viewModelScope, container.live.version) { container.api().seeds() }
}

/** The repository seeds new projects can be forked from. Read-only: seeds are managed in Studio. */
@Composable
fun SeedsScreen(onBack: () -> Unit) {
    val vm = containerViewModel { SeedsViewModel(it) }
    val seeds by vm.seeds.state.collectAsStateWithLifecycle()
    val c = Hexes.colors
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.readable().padding(horizontal = 20.dp, vertical = 12.dp)) {
            TopBar("Repository seeds", onBack) {}
            Text(
                "Repositories any project can be forked from. Add and fork them in Studio.",
                color = c.muted,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(bottom = 12.dp),
            )
            when (val r = seeds) {
                Resource.Loading -> LoadingState()
                is Resource.Failed -> ErrorState(r.message, vm.seeds::refresh)
                is Resource.Ready -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (r.data.isEmpty()) {
                        item { Text("No seeds yet.", color = c.muted, modifier = Modifier.padding(vertical = 24.dp)) }
                    }
                    items(r.data, key = { it.hex.id }) { SeedCard(it) }
                }
            }
        }
    }
}

@Composable
private fun SeedCard(seed: SeedView) {
    val c = Hexes.colors
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(seed.hex.title, style = MaterialTheme.typography.titleMedium)
            Text("${seed.gitUrl} · ${seed.branch}", color = c.ink2, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
            if (seed.hex.description.isNotBlank()) {
                Text(seed.hex.description, color = c.muted, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
