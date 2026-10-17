package dev.hexes.android.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.containerViewModel
import dev.hexes.android.data.ProjectSummary
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.data.plural
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.HexIcon
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.Panel
import dev.hexes.android.ui.components.TopBar
import dev.hexes.android.ui.theme.Hexes
import kotlinx.coroutines.launch

class ProjectsViewModel(private val container: AppContainer) : ViewModel() {
    val projects = ResourceLoader(viewModelScope, container.live.version) { container.api().projects() }
    val workspace = ResourceLoader(viewModelScope, container.live.version) { container.api().state().dir }

    /** Remember the choice on the server, as the web app does when you open a project. */
    fun select(id: String) {
        viewModelScope.launch { runCatching { container.api().selectProject(id) } }
    }
}

@Composable
fun ProjectsScreen(
    onOpenProject: (String) -> Unit,
    onSettings: () -> Unit,
    onSwitchFolder: () -> Unit,
) {
    val vm = containerViewModel { ProjectsViewModel(it) }
    val projects by vm.projects.state.collectAsStateWithLifecycle()
    val workspace by vm.workspace.state.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf("") }
    val c = Hexes.colors

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.safeDrawingPadding().padding(horizontal = 20.dp, vertical = 12.dp)) {
            TopBar("Projects", onBack = null) {
                TextButton(onClick = onSwitchFolder) { Text("+ New") }
                TextButton(onClick = onSettings) { Text("Settings") }
            }
            (workspace as? Resource.Ready<String?>)?.data?.let {
                Text("$it/.hx/data.json", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
            }
            OutlinedTextField(
                value = filter,
                onValueChange = { filter = it },
                label = { Text("Filter by title or hex id") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 12.dp),
            )
            when (val r = projects) {
                Resource.Loading -> LoadingState()
                is Resource.Failed -> ErrorState(r.message, vm.projects::refresh)
                is Resource.Ready -> {
                    val needle = filter.trim().lowercase()
                    val rows = r.data.filter {
                        needle.isEmpty() || it.title.lowercase().contains(needle) || it.id.contains(needle)
                    }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.weight(1f)) {
                        if (rows.isEmpty()) {
                            item {
                                Text(
                                    if (r.data.isEmpty()) "This folder has no projects yet." else "No projects match that filter.",
                                    color = c.muted,
                                    modifier = Modifier.padding(vertical = 24.dp),
                                )
                            }
                        }
                        items(rows, key = { it.id }) { p ->
                            ProjectCard(p) {
                                vm.select(p.id)
                                onOpenProject(p.id)
                            }
                        }
                        item { TextButton(onClick = onSwitchFolder) { Text("Open another folder") } }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectCard(p: ProjectSummary, onClick: () -> Unit) {
    val c = Hexes.colors
    Panel(Modifier.fillMaxWidth(), onClick = onClick) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            HexIcon(p.initial)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(p.title, style = MaterialTheme.typography.titleMedium)
                if (p.blurb.isNotBlank()) Text(p.blurb, color = c.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 3)
                Text(p.id, color = c.ink2, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                Text("${plural(p.epics, "epic")} · ${plural(p.stories, "story")}", color = c.muted, style = MaterialTheme.typography.bodySmall)
            }
            Text("›", color = c.muted, style = MaterialTheme.typography.headlineSmall)
        }
    }
}
