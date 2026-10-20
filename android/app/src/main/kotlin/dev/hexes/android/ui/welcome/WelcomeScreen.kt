package dev.hexes.android.ui.welcome

import dev.hexes.android.ui.components.readable
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.ui.Alignment
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
import dev.hexes.android.data.CreateProjectRequest
import dev.hexes.android.data.RecentWorkspace
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.Panel
import dev.hexes.android.ui.components.TopBar
import dev.hexes.android.ui.projects.RecentProjectsController
import dev.hexes.android.ui.projects.RecentProjectsSection
import dev.hexes.android.ui.theme.Hexes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class WelcomeViewModel(private val container: AppContainer) : ViewModel() {
    val recent = ResourceLoader(viewModelScope, container.live.version) { container.api().recentWorkspaces() }
    val recentProjects = RecentProjectsController(container, viewModelScope)
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _opening = MutableStateFlow(false)
    val opening: StateFlow<Boolean> = _opening.asStateFlow()

    private val _createError = MutableStateFlow<String?>(null)
    val createError: StateFlow<String?> = _createError.asStateFlow()
    private val _warnings = MutableStateFlow<Pair<String, List<String>>?>(null)

    /** Set when a project was created but with warnings (say, `git init` failed): shown before continuing. */
    val warnings: StateFlow<Pair<String, List<String>>?> = _warnings.asStateFlow()

    /** Creates a project folder on the server; `onCreated` runs when there is nothing to warn about. */
    fun createProject(dir: String, title: String, statement: String, gitInit: Boolean, onCreated: (String) -> Unit) {
        if (dir.isBlank() || title.isBlank()) {
            _createError.value = "Enter a folder on your computer and a title."
            return
        }
        _opening.value = true
        _createError.value = null
        viewModelScope.launch {
            runCatching { container.api().createProject(CreateProjectRequest(dir.trim(), title.trim(), statement, gitInit)) }
                .onSuccess { res ->
                    if (res.warnings.isEmpty()) onCreated(res.projectId) else _warnings.value = res.projectId to res.warnings
                }
                .onFailure { _createError.value = it.message ?: "Could not create the project." }
            _opening.value = false
        }
    }

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
fun WelcomeScreen(onBack: (() -> Unit)?, onOpened: () -> Unit, onCreated: (String) -> Unit, onOpenProject: (String) -> Unit) {
    val vm = containerViewModel { WelcomeViewModel(it) }
    val recent by vm.recent.state.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val opening by vm.opening.collectAsStateWithLifecycle()
    val createError by vm.createError.collectAsStateWithLifecycle()
    val warnings by vm.warnings.collectAsStateWithLifecycle()
    var typed by remember { mutableStateOf("") }
    var newDir by remember { mutableStateOf("") }
    var newTitle by remember { mutableStateOf("") }
    var newStatement by remember { mutableStateOf("") }
    var gitInit by remember { mutableStateOf(true) }
    val c = Hexes.colors

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.readable().imePadding().verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            TopBar("Open a project folder", onBack)
            Text(
                "Studio keeps each project in a folder on your computer (.hx/data.json). " +
                    "Pick one you opened before, or type its path.",
                color = c.ink2,
            )
            RecentProjectsSection(vm.recentProjects, onOpenProject)
            when (val r = recent) {
                Resource.Loading -> LoadingState(Modifier.padding(vertical = 24.dp))
                is Resource.Failed -> Text(r.message, color = MaterialTheme.colorScheme.error)
                is Resource.Ready -> {
                    if (r.data.isNotEmpty()) Text("Recent folders", style = MaterialTheme.typography.titleMedium)
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

            Text("Create a new project", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            Text(
                "Studio sets up the folder (and a git repo) on your computer.",
                color = c.muted,
                style = MaterialTheme.typography.bodySmall,
            )
            OutlinedTextField(
                value = newDir,
                onValueChange = { newDir = it },
                label = { Text("Location on your computer") },
                placeholder = { Text("~/code/my-project") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = newTitle,
                onValueChange = { newTitle = it },
                label = { Text("Project title") },
                placeholder = { Text("What are you building?") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = newStatement,
                onValueChange = { newStatement = it },
                label = { Text("Project statement (markdown)") },
                minLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Checkbox(checked = gitInit, onCheckedChange = { gitInit = it })
                Text("Initialize a git repo", style = MaterialTheme.typography.bodyMedium)
            }
            createError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            warnings?.let { (projectId, items) ->
                Text("Project created, but: ${items.joinToString(" ")}", color = c.ink2)
                Button(onClick = { onCreated(projectId) }) { Text("Continue") }
            }
            OutlinedButton(
                onClick = { vm.createProject(newDir, newTitle, newStatement, gitInit, onCreated) },
                enabled = !opening && warnings == null,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (opening) "Working…" else "Create project") }
            Column(Modifier.padding(bottom = 24.dp)) {}
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
