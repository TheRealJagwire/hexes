package dev.hexes.android.ui.project

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.style.TextDecoration as Deco
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dev.hexes.android.containerViewModel
import dev.hexes.android.data.EpicView
import dev.hexes.android.data.Hex
import dev.hexes.android.data.HexSummary
import dev.hexes.android.data.ProjectView
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.data.Status
import dev.hexes.android.data.relativeTime
import dev.hexes.android.data.statusSummary
import dev.hexes.android.ui.components.ClampedMarkdown
import dev.hexes.android.ui.components.CopyButton
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.KindBadge
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.MarkdownText
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.Panel
import dev.hexes.android.ui.components.ProgressRing
import dev.hexes.android.ui.components.SecondaryButton
import dev.hexes.android.ui.components.StatusPill
import dev.hexes.android.ui.components.TopBar
import dev.hexes.android.ui.theme.Hexes

class ProjectViewModel(container: dev.hexes.android.AppContainer, id: String) : ViewModel() {
    val project = ResourceLoader(viewModelScope, container.live.version) { container.api().project(id) }
}

@Composable
fun ProjectScreen(
    id: String,
    onBack: () -> Unit,
    onOpenHex: (String) -> Unit,
    onSettings: () -> Unit,
) {
    val vm = containerViewModel(key = "project-$id") { ProjectViewModel(it, id) }
    val res by vm.project.state.collectAsStateWithLifecycle()

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val r = res) {
            Resource.Loading -> LoadingState()
            is Resource.Failed -> ErrorState(r.message, vm.project::refresh) {
                SecondaryButton("All projects", onBack)
            }
            is Resource.Ready -> ProjectContent(r.data, onBack, onOpenHex, onSettings)
        }
    }
}

@Composable
private fun ProjectContent(view: ProjectView, onBack: () -> Unit, onOpenHex: (String) -> Unit, onSettings: () -> Unit) {
    val c = Hexes.colors
    val project = view.project
    LazyColumn(
        Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            TopBar(project.title, onBack) { TextButton(onClick = onSettings) { Text("Settings") } }
        }
        item { Statement(project, onOpenHex) }
        item { HexGroup("Designs", view.designs, onOpenHex) }
        item { HexGroup("Decisions", view.decisions, onOpenHex) }
        item { HexGroup("Questions", view.questions, onOpenHex) }
        if (view.epics.isNotEmpty()) {
            item { Text("Epics", style = MaterialTheme.typography.titleMedium, color = c.ink2) }
        }
        items(view.epics, key = { it.hex.id }) { epic ->
            EpicAccordion(epic, defaultOpen = epic.hex.id == view.epics.first().hex.id, onOpenHex)
        }
        item { Column(Modifier.padding(bottom = 24.dp)) {} }
    }
}

@Composable
private fun Statement(project: Hex, onOpenHex: (String) -> Unit) {
    val c = Hexes.colors
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KindBadge(project.kind)
                Text(
                    project.id,
                    color = c.ink2,
                    fontFamily = Mono,
                    style = MaterialTheme.typography.bodySmall,
                    textDecoration = Deco.Underline,
                    modifier = Modifier.weight(1f, fill = false).clickable { onOpenHex(project.id) },
                )
                CopyButton(project.id)
            }
            Text(project.title, style = MaterialTheme.typography.headlineMedium)
            if (project.description.isNotBlank()) {
                // Ten lines of body text; the rest is on the hex's own page.
                ClampedMarkdown(project.description, maxHeight = 240.dp, onReadMore = { onOpenHex(project.id) })
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                project.meta.forEach { (k, v) -> Chip("$k: $v") }
                Chip("updated ${relativeTime(project.lastUpdatedAtTimeInMs)}")
            }
        }
    }
}

@Composable
private fun Chip(text: String) {
    val c = Hexes.colors
    Text(
        text,
        color = c.muted,
        fontFamily = Mono,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .border(BorderStroke(1.dp, c.line), RoundedCornerShape(6.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun HexGroup(label: String, items: List<HexSummary>, onOpenHex: (String) -> Unit) {
    val c = Hexes.colors
    var open by rememberSaveable(label) { mutableStateOf(false) }
    Panel(Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 18.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(if (open) "▾" else "▸", color = c.muted)
                Text(label, style = MaterialTheme.typography.titleMedium)
                Text("${items.size}", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                Text(
                    statusSummary(items.map { it.status }),
                    color = c.muted,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                    modifier = Modifier.weight(1f),
                )
            }
            if (open) {
                Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (items.isEmpty()) Text("No ${label.lowercase()} yet.", color = c.muted, modifier = Modifier.padding(8.dp))
                    items.forEach { SummaryRow(it, onOpenHex) }
                }
            }
        }
    }
}

@Composable
internal fun SummaryRow(h: HexSummary, onOpenHex: (String) -> Unit) {
    val c = Hexes.colors
    Panel(Modifier.fillMaxWidth(), onClick = { onOpenHex(h.id) }) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(h.id, color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                StatusPill(h.status)
            }
            Text(h.title)
        }
    }
}

@Composable
private fun EpicAccordion(epic: EpicView, defaultOpen: Boolean, onOpenHex: (String) -> Unit) {
    val c = Hexes.colors
    var open by rememberSaveable(epic.hex.id) { mutableStateOf(defaultOpen) }
    var openStory by rememberSaveable(epic.hex.id + "-story") { mutableStateOf<String?>(null) }
    Panel(Modifier.fillMaxWidth(), strong = open) {
        Column {
            Row(
                Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 18.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(if (open) "▾" else "▸", color = c.muted)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        epic.hex.id + (epic.gate?.let { " · gate: ${it.title}" } ?: ""),
                        color = c.muted,
                        fontFamily = Mono,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(epic.hex.title, style = MaterialTheme.typography.titleMedium)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("${epic.progress.pct}%", style = MaterialTheme.typography.titleLarge)
                    Text("${epic.progress.done}/${epic.progress.total} done", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                }
                ProgressRing(epic.progress)
            }
            if (open) {
                Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (epic.stories.isEmpty()) {
                        Text("This epic doesn't depend on any stories yet.", color = c.muted, modifier = Modifier.padding(8.dp))
                    }
                    epic.stories.forEach { story ->
                        StoryRow(story, open = openStory == story.id, onToggle = { openStory = if (openStory == story.id) null else story.id }, onOpenHex)
                    }
                }
            }
        }
    }
}

@Composable
private fun StoryRow(story: Hex, open: Boolean, onToggle: () -> Unit, onOpenHex: (String) -> Unit) {
    val c = Hexes.colors
    val done = story.status == Status.Done
    run {
        Panel(Modifier.fillMaxWidth()) {
            Column {
                Row(
                    Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(if (open) "▾" else "▸", color = c.muted)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(story.id, color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                        Text(
                            story.title,
                            color = if (done) c.muted else c.ink,
                            textDecoration = if (done) Deco.LineThrough else null,
                        )
                    }
                    StatusPill(story.status)
                }
                if (open) {
                    Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (story.description.isNotBlank()) {
                            MarkdownText(story.description, body = MaterialTheme.typography.bodyMedium)
                        } else {
                            Text("No description yet.", color = c.muted)
                        }
                        story.meta.forEach { (k, v) ->
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(k, color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(0.4f))
                                Text(v, fontFamily = Mono, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(0.6f))
                            }
                        }
                        OutlinedButton(onClick = { onOpenHex(story.id) }) { Text("Open hex ↗") }
                    }
                }
            }
        }
    }
}
