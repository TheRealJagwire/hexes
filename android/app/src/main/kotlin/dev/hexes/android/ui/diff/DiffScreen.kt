package dev.hexes.android.ui.diff

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.containerViewModel
import dev.hexes.android.data.DiffFile
import dev.hexes.android.data.DiffLine
import dev.hexes.android.data.Hex
import dev.hexes.android.data.PullRequestDiff
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.data.plural
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.Panel
import dev.hexes.android.ui.components.SecondaryButton
import dev.hexes.android.ui.components.StatusPill
import dev.hexes.android.ui.components.TopBar
import dev.hexes.android.ui.components.readable
import dev.hexes.android.ui.components.tappable
import dev.hexes.android.ui.theme.Hexes

/** A pull request and what it changes, loaded together. */
data class DiffPage(val pr: Hex, val diff: PullRequestDiff)

class DiffViewModel(container: AppContainer, prId: String) : ViewModel() {
    val page = ResourceLoader(viewModelScope, container.live.version) {
        val api = container.api()
        DiffPage(api.hex(prId).hex, api.pullRequestDiff(prId))
    }
}

/** A pull request's changes, opened from its work hex: files with +/- counts and numbered hunks. */
@Composable
fun DiffScreen(workId: String, prId: String, onBack: () -> Unit) {
    val vm = containerViewModel(key = "diff-$workId-$prId") { DiffViewModel(it, prId) }
    val res by vm.page.state.collectAsStateWithLifecycle()
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val r = res) {
            Resource.Loading -> LoadingState()
            is Resource.Failed -> ErrorState(r.message, vm.page::refresh, missing = r.missing) { SecondaryButton("Back", onBack) }
            is Resource.Ready -> DiffContent(r.data, onBack)
        }
    }
}

@Composable
private fun DiffContent(page: DiffPage, onBack: () -> Unit) {
    val c = Hexes.colors
    val diff = page.diff
    LazyColumn(
        Modifier.readable().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { TopBar("Changes", onBack) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusPill(page.pr.status)
                Text(page.pr.title, style = MaterialTheme.typography.headlineSmall)
                Text(
                    "${page.pr.meta["source_branch"]} → ${page.pr.meta["target_branch"]}",
                    fontFamily = Mono,
                    color = c.muted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        item {
            val adds = diff.files.sumOf { it.additions }
            val dels = diff.files.sumOf { it.deletions }
            val notes = listOfNotNull(
                "from the copy saved at merge time (the commits are gone)".takeIf { diff.source == "snapshot" },
                "too large to show line by line".takeIf { diff.truncated },
            )
            Text(
                (listOf("${plural(diff.files.size, "file")} changed · +$adds −$dels") + notes).joinToString(" · "),
                color = c.muted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (diff.files.isEmpty()) item { Text("No changes.", color = c.muted) }
        items(diff.files, key = { it.path }) { file -> FileCard(file, diff.truncated) }
        item { Column(Modifier.padding(bottom = 24.dp)) {} }
    }
}

@Composable
private fun FileCard(file: DiffFile, truncated: Boolean) {
    val c = Hexes.colors
    var open by rememberSaveable(file.path) { mutableStateOf(file.hunks.isNotEmpty() && file.hunks.size < 40) }
    val label = file.oldPath?.let { "$it → ${file.path}" } ?: file.path
    Panel(Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.fillMaxWidth()
                    .tappable(if (open) "Collapse $label" else "Expand $label") { open = !open }
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(label, fontFamily = Mono, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Text(file.status, color = c.muted, fontSize = 12.sp)
                Text("+${file.additions}", color = c.success, fontFamily = Mono, fontSize = 12.sp)
                Text("−${file.deletions}", color = c.blocked, fontFamily = Mono, fontSize = 12.sp)
            }
            if (open) {
                when {
                    file.binary -> Note("Binary file changed.")
                    file.hunks.isEmpty() ->
                        Note(if (truncated) "Too large to show line by line." else "No line changes (mode or rename only).")
                    // Long lines scroll sideways inside the file; the screen keeps its width.
                    else -> Column(Modifier.horizontalScroll(rememberScrollState())) {
                        file.hunks.forEach { hunk ->
                            Text(
                                hunk.header,
                                fontFamily = Mono,
                                fontSize = 12.sp,
                                color = c.muted,
                                modifier = Modifier.background(c.panel2).padding(horizontal = 8.dp, vertical = 2.dp),
                            )
                            hunk.lines.forEach { DiffRow(it) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(text, color = Hexes.colors.muted, modifier = Modifier.padding(12.dp))
}

@Composable
private fun DiffRow(line: DiffLine) {
    val c = Hexes.colors
    val (bg, mark, spoken) = when (line.kind) {
        "add" -> Triple(c.diffAddBg, "+", "added")
        "del" -> Triple(c.diffDelBg, "−", "removed")
        else -> Triple(Color.Transparent, " ", "unchanged")
    }
    Row(
        Modifier.background(bg).semantics(mergeDescendants = true) {
            contentDescription = "$spoken line ${line.newNo ?: line.oldNo}: ${line.text}"
        },
    ) {
        LineNo(line.oldNo)
        LineNo(line.newNo)
        Text(mark, fontFamily = Mono, fontSize = 12.sp, color = c.muted, modifier = Modifier.width(14.dp))
        Text(line.text, fontFamily = Mono, fontSize = 12.sp, color = c.ink, softWrap = false, modifier = Modifier.padding(end = 12.dp))
    }
}

@Composable
private fun LineNo(n: Int?) {
    Text(
        n?.toString() ?: "",
        fontFamily = Mono,
        fontSize = 12.sp,
        color = Hexes.colors.muted,
        textAlign = TextAlign.End,
        modifier = Modifier.width(40.dp).padding(end = 6.dp),
    )
}
