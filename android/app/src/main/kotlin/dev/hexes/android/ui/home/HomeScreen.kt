package dev.hexes.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import dev.hexes.android.container
import dev.hexes.android.data.ProjectSummary
import dev.hexes.android.ui.theme.Hexes

/** A placeholder landing screen that proves the connection works; the real screens come next. */
@Composable
fun HomeScreen(onOpenSettings: () -> Unit) {
    val container = LocalContext.current.container
    val vm: HomeViewModel = viewModel(
        factory = viewModelFactory { initializer { HomeViewModel(container) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = Hexes.colors

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.safeDrawingPadding().padding(horizontal = 20.dp, vertical = 16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Hexes", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = onOpenSettings) { Text("Settings") }
            }
            when (val s = state) {
                HomeUiState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                is HomeUiState.Failed -> Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(s.message, color = MaterialTheme.colorScheme.error)
                    Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(onClick = vm::load) { Text("Retry") }
                        OutlinedButton(onClick = onOpenSettings) { Text("Settings") }
                    }
                }
                is HomeUiState.Ready -> {
                    Text(
                        s.workspace ?: "No workspace open on the server yet.",
                        color = colors.muted,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(bottom = 12.dp),
                    )
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(s.projects, key = { it.id }) { ProjectCard(it) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectCard(project: ProjectSummary) {
    val colors = Hexes.colors
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = colors.panel),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(project.title, style = MaterialTheme.typography.titleMedium)
            if (project.blurb.isNotBlank()) Text(project.blurb, color = colors.ink2)
            Text("${project.epics} epics · ${project.stories} stories", color = colors.muted,
                style = MaterialTheme.typography.bodySmall)
        }
    }
}
