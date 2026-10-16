package dev.hexes.android.ui.hex

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.containerViewModel
import dev.hexes.android.data.HexSummary
import dev.hexes.android.data.HexView
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.data.dateTime
import dev.hexes.android.data.kindQualifier
import dev.hexes.android.ui.components.CopyButton
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.KindBadge
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.MarkdownText
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.Panel
import dev.hexes.android.ui.components.SecondaryButton
import dev.hexes.android.ui.components.StatusPill
import dev.hexes.android.ui.components.TopBar
import dev.hexes.android.ui.components.statusColors
import dev.hexes.android.ui.project.SummaryRow
import dev.hexes.android.ui.theme.Hexes

class HexViewModel(container: AppContainer, id: String) : ViewModel() {
    val hex = ResourceLoader(viewModelScope, container.live.version) { container.api().hex(id) }
}

@Composable
fun HexScreen(
    id: String,
    onBack: () -> Unit,
    onOpenHex: (String) -> Unit,
    onOpenProject: (String) -> Unit,
) {
    val vm = containerViewModel(key = "hex-$id") { HexViewModel(it, id) }
    val res by vm.hex.state.collectAsStateWithLifecycle()

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val r = res) {
            Resource.Loading -> LoadingState()
            is Resource.Failed -> ErrorState(r.message, vm.hex::refresh) { SecondaryButton("Back", onBack) }
            is Resource.Ready -> HexContent(r.data, onBack, onOpenHex, onOpenProject)
        }
    }
}

@Composable
private fun HexContent(view: HexView, onBack: () -> Unit, onOpenHex: (String) -> Unit, onOpenProject: (String) -> Unit) {
    val c = Hexes.colors
    val hex = view.hex
    LazyColumn(
        Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { TopBar(kindQualifier(hex.kind), onBack) }
        item { Breadcrumbs(view.breadcrumbs, onOpenHex, onOpenProject) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KindBadge(hex.kind)
                Text(hex.id, color = c.ink2, fontFamily = Mono, modifier = Modifier.weight(1f, fill = false))
                CopyButton(hex.id)
            }
        }
        item { Text(hex.title, style = MaterialTheme.typography.headlineMedium) }
        item { StatusPill(hex.status) }
        item {
            if (hex.description.isBlank()) Text("No description.", color = c.muted) else MarkdownText(hex.description)
        }
        item { FieldsPanel(view, onOpenHex) }
        if (hex.meta.isNotEmpty()) item { MetaPanel(hex.meta) }
        item { RelatedPanel("Depends on", view.dependsOn, onOpenHex) }
        item { RelatedPanel("Depended on by", view.dependedOnBy, onOpenHex, footer = view.emergedHere, onOpenHexFooter = onOpenHex) }
        item { Column(Modifier.padding(bottom = 24.dp)) {} }
    }
}

@Composable
private fun Breadcrumbs(trail: List<HexSummary>, onOpenHex: (String) -> Unit, onOpenProject: (String) -> Unit) {
    val c = Hexes.colors
    LazyRow(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        items(trail.size) { i ->
            val h = trail[i]
            val last = i == trail.size - 1
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier
                        .clickable(enabled = !last) {
                            if (h.kind == "core.project") onOpenProject(h.id) else onOpenHex(h.id)
                        }
                        .padding(horizontal = 6.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(kindQualifier(h.kind), color = c.accent, fontFamily = Mono, style = MaterialTheme.typography.labelSmall)
                    Text(h.title, color = if (last) c.ink else c.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                }
                if (!last) Text("›", color = c.lineStrong)
            }
        }
    }
}

@Composable
private fun FieldsPanel(view: HexView, onOpenHex: (String) -> Unit) {
    val c = Hexes.colors
    val hex = view.hex
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Fields", style = MaterialTheme.typography.titleSmall, color = c.muted)
            Field("kind", hex.kind)
            Field("created", dateTime(hex.createdAtTimeInMs))
            Field("updated", dateTime(hex.lastUpdatedAtTimeInMs))
            val from = view.emergedFromHex
            if (from != null) {
                Column {
                    Text("emergedFrom", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                    Text(
                        "${from.id} · ${from.title}",
                        color = c.ink2,
                        fontFamily = Mono,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.clickable { onOpenHex(from.id) }.padding(vertical = 4.dp),
                    )
                }
            } else {
                Field("emergedFrom", "—")
            }
        }
    }
}

@Composable
private fun Field(name: String, value: String) {
    val c = Hexes.colors
    Column {
        Text(name, color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
        Text(value, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun MetaPanel(meta: Map<String, String>) {
    val c = Hexes.colors
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Meta", style = MaterialTheme.typography.titleSmall, color = c.muted)
            meta.forEach { (k, v) -> Field(k, v) }
        }
    }
}

@Composable
private fun RelatedPanel(
    title: String,
    items: List<HexSummary>,
    onOpenHex: (String) -> Unit,
    footer: List<HexSummary> = emptyList(),
    onOpenHexFooter: (String) -> Unit = {},
) {
    val c = Hexes.colors
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = c.muted)
            if (items.isEmpty()) Text("none", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
            items.forEach { SummaryRow(it, onOpenHex) }
            if (footer.isNotEmpty()) {
                Text("emerged from here:", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                footer.forEach { h ->
                    Text(
                        "${h.id} · ${h.title}",
                        color = c.ink2,
                        fontFamily = Mono,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.clickable { onOpenHexFooter(h.id) }.padding(vertical = 4.dp),
                    )
                }
            }
        }
    }
}
