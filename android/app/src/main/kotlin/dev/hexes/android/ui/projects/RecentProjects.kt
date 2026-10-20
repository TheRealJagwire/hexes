package dev.hexes.android.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.hexes.android.AppContainer
import dev.hexes.android.data.RecentProject
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.data.relativeTime
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.Panel
import dev.hexes.android.ui.theme.Hexes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Recent projects across folders, and switching to or forgetting one. Owned by a screen's ViewModel. */
class RecentProjectsController(private val container: AppContainer, private val scope: CoroutineScope) {
    val recent = ResourceLoader(scope, container.live.version) { container.api().recentProjects() }
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private fun run(block: suspend () -> Unit) {
        if (_busy.value) return
        _busy.value = true
        _error.value = null
        scope.launch {
            runCatching { block() }.onFailure { _error.value = it.message ?: "That didn't work." }
            _busy.value = false
        }
    }

    /** Opens the project's folder on the server when needed and selects it, then `onOpened`. */
    fun open(r: RecentProject, onOpened: (String) -> Unit) = run {
        container.api().openRecentProject(r.dir, r.projectId)
        onOpened(r.projectId)
    }

    fun forget(r: RecentProject) = run {
        container.api().forgetRecentProject(r.dir, r.projectId)
        recent.refresh()
    }
}

/** The "Recent" list: nothing while loading, failing or empty, so screens can always include it. */
@Composable
fun RecentProjectsSection(controller: RecentProjectsController, onOpenProject: (String) -> Unit) {
    val res by controller.recent.state.collectAsStateWithLifecycle()
    val busy by controller.busy.collectAsStateWithLifecycle()
    val error by controller.error.collectAsStateWithLifecycle()
    val list = (res as? Resource.Ready)?.data.orEmpty()
    if (list.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Recent", style = MaterialTheme.typography.titleMedium)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        list.forEach { r -> RecentProjectRow(r, busy, onOpen = { controller.open(r, onOpenProject) }, onForget = { controller.forget(r) }) }
    }
}

@Composable
private fun RecentProjectRow(r: RecentProject, busy: Boolean, onOpen: () -> Unit, onForget: () -> Unit) {
    val c = Hexes.colors
    val usable = r.found && r.switchable
    val why = when {
        !r.found -> "folder or project is gone"
        !r.switchable -> "Studio is pinned to another folder"
        else -> null
    }
    Panel(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {
            contentDescription = listOfNotNull(r.title, "in ${r.folder}", "open now".takeIf { r.current }, why).joinToString(", ")
        },
        onClick = if (usable && !busy) onOpen else null,
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(r.title, style = MaterialTheme.typography.titleMedium, color = if (usable) c.ink else c.muted)
                Text(
                    "${r.folder} · ${relativeTime(r.openedAt)}" + (if (r.current) " · open now" else ""),
                    color = c.muted,
                    fontFamily = Mono,
                    style = MaterialTheme.typography.bodySmall,
                )
                why?.let { Text(it, color = c.blocked, style = MaterialTheme.typography.bodySmall) }
            }
            if (usable) Text("›", color = c.muted, style = MaterialTheme.typography.headlineSmall)
            else TextButton(onClick = onForget, enabled = !busy) { Text("Remove") }
        }
    }
}
