package dev.hexes.android.ui.welcome

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.containerViewModel
import dev.hexes.android.data.RecentWorkspace
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.Panel
import dev.hexes.android.ui.components.TopBar
import dev.hexes.android.ui.theme.Hexes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class WelcomeViewModel(private val container: AppContainer) : ViewModel() {
    val recent = ResourceLoader(viewModelScope, container.live.version) { container.api().recentWorkspaces() }
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _opening = MutableStateFlow(false)
    val opening: StateFlow<Boolean> = _opening.asStateFlow()

    /** Opens a folder on the server; calls `onOpened` when it worked. */
    fun open(dir: String, onOpened: () -> Unit) {
        if (dir.isBlank()) {
            _error.value = "Enter the folder that contains .hx/data.json."
            return
        }
        _opening.value = true
        _error.value = null
        viewModelScope.launch {
            runCatching { container.api().openWorkspace(dir.trim()) }
                .onSuccess { onOpened() }
                .onFailure { _error.value = it.message ?: "Could not open that folder." }
            _opening.value = false
        }
    }
}

/** Picks which folder on the computer Studio works on (the phone cannot browse it, so: recent or typed). */
@Composable
fun WelcomeScreen(onBack: (() -> Unit)?, onOpened: () -> Unit) {
    val vm = containerViewModel { WelcomeViewModel(it) }
    val recent by vm.recent.state.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val opening by vm.opening.collectAsStateWithLifecycle()
    var typed by remember { mutableStateOf("") }
    val c = Hexes.colors

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.safeDrawingPadding().imePadding().verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            TopBar("Open a project folder", onBack)
            Text(
                "Studio keeps each project in a folder on your computer (.hx/data.json). " +
                    "Pick one you opened before, or type its path.",
                color = c.ink2,
            )
            when (val r = recent) {
                Resource.Loading -> LoadingState(Modifier.padding(vertical = 24.dp))
                is Resource.Failed -> Text(r.message, color = MaterialTheme.colorScheme.error)
                is Resource.Ready -> {
                    if (r.data.isNotEmpty()) Text("Recent", style = MaterialTheme.typography.titleMedium)
                    r.data.forEach { ws -> RecentRow(ws, enabled = !opening) { vm.open(ws.dir, onOpened) } }
                }
            }
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                label = { Text("Folder path on your computer") },
                placeholder = { Text("~/code/my-project") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = { vm.open(typed, onOpened) }, enabled = !opening, modifier = Modifier.fillMaxWidth()) {
                Text(if (opening) "Opening…" else "Open")
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun RecentRow(ws: RecentWorkspace, enabled: Boolean, onClick: () -> Unit) {
    val c = Hexes.colors
    Panel(Modifier.fillMaxWidth(), onClick = if (enabled && ws.found) onClick else null) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(ws.label, style = MaterialTheme.typography.titleMedium)
                Text(ws.dir, color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
            }
            if (!ws.found) Text("missing", color = c.blocked, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
        }
    }
}
