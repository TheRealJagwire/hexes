package dev.hexes.android.ui.create

import dev.hexes.android.ui.components.readable
import dev.hexes.android.ui.components.tappable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dev.hexes.android.AppContainer
import dev.hexes.android.containerViewModel
import dev.hexes.android.data.Hex
import dev.hexes.android.data.HexSummary
import dev.hexes.android.data.Resource
import dev.hexes.android.data.ResourceLoader
import dev.hexes.android.data.Status
import dev.hexes.android.data.StatusTable
import dev.hexes.android.data.kindQualifier
import dev.hexes.android.ui.components.ErrorState
import dev.hexes.android.ui.components.LoadingState
import dev.hexes.android.ui.components.Mono
import dev.hexes.android.ui.components.SecondaryButton
import dev.hexes.android.ui.components.StatusPill
import dev.hexes.android.ui.components.TopBar
import dev.hexes.android.ui.theme.Hexes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class CreateHexViewModel(
    private val container: AppContainer,
    private val projectId: String,
    emergedFromId: String?,
) : ViewModel() {
    val project = ResourceLoader(viewModelScope, container.live.version) { container.api().hex(projectId) }
    val hexes = ResourceLoader(viewModelScope, container.live.version) { container.api().projectHexes(projectId) }

    private val _form = MutableStateFlow(CreateHexForm())
    val form: StateFlow<CreateHexForm> = _form.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** Which statuses each kind allows; the legacy table until the server's arrives. */
    private val _statuses = MutableStateFlow(StatusTable.LEGACY)
    val statuses: StateFlow<StatusTable> = _statuses.asStateFlow()

    init {
        viewModelScope.launch { runCatching { container.statuses() }.onSuccess { _statuses.value = it } }
    }

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var pendingEmergedFrom: String? = emergedFromId

    /** Fills "emerged from" once the hex list has loaded, when the screen was opened from a hex. */
    fun resolveEmergedFrom(options: List<HexSummary>) {
        val id = pendingEmergedFrom ?: return
        pendingEmergedFrom = null
        options.firstOrNull { it.id == id }?.let { found -> edit { it.copy(emergedFrom = found) } }
    }

    fun edit(change: (CreateHexForm) -> CreateHexForm) {
        _form.update(change)
        _error.value = null
    }

    fun submit(onCreated: (Hex) -> Unit) {
        val current = _form.value
        if (!current.canSubmit || _busy.value) return
        _busy.value = true
        _error.value = null
        viewModelScope.launch {
            runCatching { container.api().createHex(current.toRequest(projectId, container.statuses())) }
                .onSuccess(onCreated)
                .onFailure { _error.value = it.message ?: "Could not create the hex." }
            _busy.value = false
        }
    }
}

@Composable
fun CreateHexScreen(projectId: String, emergedFrom: String?, onClose: () -> Unit, onCreated: (Hex) -> Unit) {
    val vm = containerViewModel(key = "create-$projectId-$emergedFrom") { CreateHexViewModel(it, projectId, emergedFrom) }
    val project by vm.project.state.collectAsStateWithLifecycle()
    val hexes by vm.hexes.state.collectAsStateWithLifecycle()

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when {
            project is Resource.Failed ->
                ErrorState((project as Resource.Failed).message, vm.project::refresh) { SecondaryButton("Close", onClose) }
            hexes is Resource.Failed ->
                ErrorState((hexes as Resource.Failed).message, vm.hexes::refresh) { SecondaryButton("Close", onClose) }
            project is Resource.Ready && hexes is Resource.Ready -> {
                val options = (hexes as Resource.Ready<List<HexSummary>>).data
                androidx.compose.runtime.LaunchedEffect(options) { vm.resolveEmergedFrom(options) }
                CreateHexContent(
                    projectTitle = (project as Resource.Ready<dev.hexes.android.data.HexView>).data.hex.title,
                    projectId = projectId,
                    options = options,
                    vm = vm,
                    onClose = onClose,
                    onCreated = onCreated,
                )
            }
            else -> LoadingState()
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CreateHexContent(
    projectTitle: String,
    projectId: String,
    options: List<HexSummary>,
    vm: CreateHexViewModel,
    onClose: () -> Unit,
    onCreated: (Hex) -> Unit,
) {
    val c = Hexes.colors
    val form by vm.form.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val statuses by vm.statuses.collectAsStateWithLifecycle()

    Column(
        Modifier.readable().imePadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        TopBar("Create hex", onClose)
        Text("in $projectTitle · $projectId", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)

        Text("Kind", style = MaterialTheme.typography.titleSmall, color = c.ink2)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CREATE_KINDS.forEach { k ->
                FilterChip(
                    selected = form.customKind.isBlank() && form.kind == k,
                    onClick = { vm.edit { it.copy(kind = k, customKind = "") } },
                    label = { Text(k, fontFamily = Mono) },
                )
            }
        }
        OutlinedTextField(
            value = form.customKind,
            onValueChange = { v -> vm.edit { it.copy(customKind = v) } },
            label = { Text("or a custom kind") },
            placeholder = { Text("studio.my_kind") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = form.title,
            onValueChange = { v -> vm.edit { it.copy(title = v) } },
            label = { Text("Title") },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = form.description,
            onValueChange = { v -> vm.edit { it.copy(description = v) } },
            label = { Text("Description / value (markdown)") },
            minLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )

        StatusField(form.effectiveStatus(statuses), form.statusOptions(statuses)) { s -> vm.edit { it.copy(status = s) } }

        SinglePicker(
            label = "Emerged from",
            hint = "optional",
            value = form.emergedFrom,
            options = options,
            onChange = { h -> vm.edit { it.copy(emergedFrom = h) } },
        )
        MultiPicker(
            label = "Required by",
            hint = "these hexes will depend on this one",
            options = options,
            value = form.requiredBy,
            onChange = { v -> vm.edit { it.copy(requiredBy = v) } },
        )
        MultiPicker(
            label = "Depends on",
            hint = "must be done before this is ready",
            options = options,
            value = form.dependsOn,
            onChange = { v -> vm.edit { it.copy(dependsOn = v) } },
        )

        Text("Meta", style = MaterialTheme.typography.titleSmall, color = c.ink2)
        form.meta.forEachIndexed { i, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = row.key,
                    onValueChange = { v -> vm.edit { f -> f.copy(meta = f.meta.mapIndexed { j, r -> if (j == i) r.copy(key = v) else r }) } },
                    label = { Text("key") },
                    singleLine = true,
                    modifier = Modifier.weight(2f),
                )
                OutlinedTextField(
                    value = row.value,
                    onValueChange = { v -> vm.edit { f -> f.copy(meta = f.meta.mapIndexed { j, r -> if (j == i) r.copy(value = v) else r }) } },
                    label = { Text("value") },
                    singleLine = true,
                    modifier = Modifier.weight(3f),
                )
                TextButton(onClick = { vm.edit { f -> f.copy(meta = f.meta.filterIndexed { j, _ -> j != i }) } }) { Text("✕") }
            }
        }
        OutlinedButton(onClick = { vm.edit { it.copy(meta = it.meta + MetaRow()) } }, modifier = Modifier.align(Alignment.Start)) {
            Text("+ Add meta")
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 24.dp)) {
            OutlinedButton(onClick = onClose, enabled = !busy) { Text("Cancel") }
            Button(onClick = { vm.submit(onCreated) }, enabled = form.canSubmit && !busy) {
                Text(if (busy) "Creating…" else "Create ${kindQualifier(form.effectiveKind)}")
            }
        }
    }
}

@Composable
private fun StatusField(status: Status, options: List<Status>, onChange: (Status) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val c = Hexes.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Status", style = MaterialTheme.typography.titleSmall, color = c.ink2)
        Box {
            Row(
                Modifier.tappable("Change status") { open = true },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                StatusPill(status)
                Text("▾", color = c.muted)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { s ->
                    DropdownMenuItem(text = { StatusPill(s) }, onClick = { open = false; onChange(s) })
                }
            }
        }
    }
}

/** One optional hex, chosen from a searchable sheet. */
@Composable
private fun SinglePicker(label: String, hint: String, value: HexSummary?, options: List<HexSummary>, onChange: (HexSummary?) -> Unit) {
    val c = Hexes.colors
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("$label · $hint", style = MaterialTheme.typography.titleSmall, color = c.ink2)
        if (value != null) HexChip(value) { onChange(null) }
        OutlinedButton(onClick = { open = true }) { Text(if (value == null) "Choose…" else "Change…") }
    }
    if (open) {
        PickerSheet(options, taken = emptySet(), onDismiss = { open = false }) { onChange(it); open = false }
    }
}

/** Several hexes, shown as removable chips, added through a searchable sheet. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MultiPicker(label: String, hint: String, options: List<HexSummary>, value: List<HexSummary>, onChange: (List<HexSummary>) -> Unit) {
    val c = Hexes.colors
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("$label · $hint", style = MaterialTheme.typography.titleSmall, color = c.ink2)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            value.forEach { h -> HexChip(h) { onChange(value.filter { it.id != h.id }) } }
        }
        OutlinedButton(onClick = { open = true }) { Text("+ Add") }
    }
    if (open) {
        // Stay open after each pick so several hexes can be added in one go.
        PickerSheet(options, taken = value.map { it.id }.toSet(), onDismiss = { open = false }) { onChange(value + it) }
    }
}

@Composable
private fun HexChip(h: HexSummary, onRemove: () -> Unit) {
    val c = Hexes.colors
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier.clip(shape).border(BorderStroke(1.dp, c.lineStrong), shape).padding(start = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "${kindQualifier(h.kind)} · ${h.id} ${h.title}",
            fontFamily = Mono,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            modifier = Modifier.weight(1f, fill = false),
        )
        TextButton(onClick = onRemove) { Text("✕", color = c.muted) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PickerSheet(options: List<HexSummary>, taken: Set<String>, onDismiss: () -> Unit, onPick: (HexSummary) -> Unit) {
    val c = Hexes.colors
    var query by remember { mutableStateOf("") }
    val matches = remember(options, query, taken) { searchHexes(options, query, taken) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Search by title or id") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (matches.isEmpty()) Text("No matching hexes.", color = c.muted, modifier = Modifier.padding(vertical = 12.dp))
            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(matches, key = { it.id }) { h ->
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { onPick(h) }.padding(horizontal = 8.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "${h.id} · ${kindQualifier(h.kind)}",
                                color = c.muted,
                                fontFamily = Mono,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.weight(1f),
                            )
                            StatusPill(h.status)
                        }
                        Text(h.title)
                    }
                }
            }
        }
    }
}
