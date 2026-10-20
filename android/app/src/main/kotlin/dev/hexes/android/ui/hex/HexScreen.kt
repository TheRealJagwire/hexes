package dev.hexes.android.ui.hex

import dev.hexes.android.ui.components.readable
import dev.hexes.android.ui.components.tappable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import dev.hexes.android.data.Hex
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
import dev.hexes.android.data.ApiClient
import dev.hexes.android.data.ApiException
import dev.hexes.android.data.Status
import dev.hexes.android.data.StatusTable
import dev.hexes.android.data.UpdateHexRequest
import dev.hexes.android.data.deleteImpactText
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
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

/** Why a text edit did not go through; a stale edit can be forced through on purpose. */
data class EditError(val message: String, val stale: Boolean)

class HexViewModel(private val container: AppContainer, private val id: String) : ViewModel() {
    val hex = ResourceLoader(viewModelScope, container.live.version) { container.api().hex(id) }

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _editError = MutableStateFlow<EditError?>(null)
    val editError: StateFlow<EditError?> = _editError.asStateFlow()

    /** Which statuses each kind allows; null until the server's table arrives. */
    private val _statuses = MutableStateFlow<StatusTable?>(null)
    val statuses: StateFlow<StatusTable?> = _statuses.asStateFlow()

    init {
        viewModelScope.launch { runCatching { container.statuses() }.onSuccess { _statuses.value = it } }
    }

    /** One-off messages for the snackbar: failures of status, meta and delete actions. */
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    private fun launchWrite(onFailure: (ApiException) -> Unit, block: suspend (ApiClient) -> Unit, onSuccess: () -> Unit = {}) {
        if (_busy.value) return
        _busy.value = true
        viewModelScope.launch {
            try {
                block(container.api())
                hex.refresh()
                onSuccess()
            } catch (e: ApiException) {
                onFailure(e)
            } finally {
                _busy.value = false
            }
        }
    }

    private fun say(e: ApiException) {
        _messages.tryEmit(e.message ?: "That didn't work.")
    }

    fun setStatus(status: Status) =
        launchWrite(::say, { it.updateHex(id, UpdateHexRequest(status = status)) })

    /** Why the last answer was refused, shown in the answer dialog. */
    private val _answerError = MutableStateFlow<String?>(null)
    val answerError: StateFlow<String?> = _answerError.asStateFlow()

    /** Sets a status that needs a response (answering a question), sending both together. */
    fun answer(status: Status, response: String, onDone: () -> Unit) {
        _answerError.value = null
        launchWrite(
            onFailure = { e -> _answerError.value = e.message ?: "Could not save the answer." },
            block = { it.updateHex(id, UpdateHexRequest(status = status, response = response.trim())) },
            onSuccess = onDone,
        )
    }

    fun clearAnswerError() {
        _answerError.value = null
    }

    /**
     * Saves the title and description. `expected` is the version the editor was opened on, so an
     * edit made while someone else changed the hex is refused (unless `force`).
     */
    fun saveText(title: String, description: String, expected: Long, force: Boolean, onSaved: () -> Unit) {
        _editError.value = null
        launchWrite(
            onFailure = { e ->
                _editError.value = EditError(e.message ?: "Could not save.", stale = e is ApiException.Http && e.status == 409)
            },
            block = {
                it.updateHex(
                    id,
                    UpdateHexRequest(title = title.trim(), description = description, expectedUpdatedAtTimeInMs = if (force) null else expected),
                )
            },
            onSuccess = onSaved,
        )
    }

    fun clearEditError() {
        _editError.value = null
    }

    fun setMeta(key: String, value: String, onDone: () -> Unit) =
        launchWrite(::say, { it.setMeta(id, key.trim(), value) }, onDone)

    fun removeMeta(key: String) = launchWrite(::say, { it.removeMeta(id, key) })

    fun delete(onDeleted: () -> Unit) =
        launchWrite(::say, { it.deleteHex(id) }, onDeleted)
}

@Composable
fun HexScreen(
    id: String,
    onBack: () -> Unit,
    onOpenHex: (String) -> Unit,
    onOpenProject: (String) -> Unit,
    onCreateFrom: (projectId: String, hexId: String) -> Unit,
    onDeleted: (projectId: String?, wasProject: Boolean) -> Unit,
) {
    val vm = containerViewModel(key = "hex-$id") { HexViewModel(it, id) }
    val res by vm.hex.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize()) {
            when (val r = res) {
                Resource.Loading -> LoadingState()
                is Resource.Failed -> ErrorState(r.message, vm.hex::refresh, missing = r.missing) { SecondaryButton("Back", onBack) }
                is Resource.Ready -> HexContent(r.data, vm, onBack, onOpenHex, onOpenProject, onCreateFrom, onDeleted)
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).safeDrawingPadding().padding(12.dp))
        }
    }
}

@Composable
private fun HexContent(
    view: HexView,
    vm: HexViewModel,
    onBack: () -> Unit,
    onOpenHex: (String) -> Unit,
    onOpenProject: (String) -> Unit,
    onCreateFrom: (projectId: String, hexId: String) -> Unit,
    onDeleted: (projectId: String?, wasProject: Boolean) -> Unit,
) {
    val c = Hexes.colors
    val hex = view.hex
    val busy by vm.busy.collectAsStateWithLifecycle()
    val statuses by vm.statuses.collectAsStateWithLifecycle()
    // The status being set through the answer dialog, by its wire name so it survives rotation.
    var answering by rememberSaveable(hex.id) { mutableStateOf<String?>(null) }
    var editing by rememberSaveable(hex.id) { mutableStateOf(false) }
    // The version the editor was opened on: a change made meanwhile is detected on save.
    var editedFrom by rememberSaveable(hex.id) { mutableLongStateOf(0L) }

    LazyColumn(
        Modifier.readable().imePadding().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            TopBar(kindQualifier(hex.kind), onBack) {
                view.projectId?.let { pid -> TextButton(onClick = { onCreateFrom(pid, hex.id) }) { Text("+ Hex from this") } }
            }
        }
        item { Breadcrumbs(view.breadcrumbs, onOpenHex, onOpenProject) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KindBadge(hex.kind)
                Text(hex.id, color = c.ink2, fontFamily = Mono, modifier = Modifier.weight(1f, fill = false))
                CopyButton(hex.id)
            }
        }
        if (editing) {
            item {
                EditTextCard(
                    hex = view.hex,
                    vm = vm,
                    editedFrom = editedFrom,
                    onClose = { editing = false },
                )
            }
        } else {
            item { Text(hex.title, style = MaterialTheme.typography.headlineMedium) }
            item {
                val options = statuses?.options(hex.kind, hex.status) ?: listOf(hex.status)
                StatusMenu(hex.status, options, enabled = !busy && statuses != null) { picked ->
                    if (statuses?.requiresResponse?.contains(picked) == true) {
                        vm.clearAnswerError()
                        answering = picked.wire
                    } else {
                        vm.setStatus(picked)
                    }
                }
            }
            item {
                if (hex.description.isBlank()) Text("No description.", color = c.muted) else MarkdownText(hex.description)
            }
            hex.meta["answer"]?.let { answer -> item { AnswerPanel(answer, hex.meta, onOpenHex) } }
            item {
                TextButton(onClick = {
                    vm.clearEditError()
                    editedFrom = hex.lastUpdatedAtTimeInMs
                    editing = true
                }) { Text("Edit title & description") }
            }
        }
        item { FieldsPanel(view, onOpenHex) }
        item { MetaPanel(hex.meta, busy, vm) }
        item { RelatedPanel("Depends on", view.dependsOn, onOpenHex) }
        item { RelatedPanel("Depended on by", view.dependedOnBy, onOpenHex, footer = view.emergedHere, onOpenHexFooter = onOpenHex) }
        item {
            DeletePanel(view, busy) {
                vm.delete { onDeleted(view.projectId, hex.kind == "core.project") }
            }
        }
        item { Column(Modifier.padding(bottom = 24.dp)) {} }
    }

    answering?.let { wire ->
        AnswerDialog(
            title = hex.title,
            busy = busy,
            vm = vm,
            onDismiss = { answering = null },
            onSubmit = { response -> vm.answer(Status.fromWire(wire), response) { answering = null } },
        )
    }
}

/** Asks for the response that answering a question needs; the answer is not saved without one. */
@Composable
private fun AnswerDialog(title: String, busy: Boolean, vm: HexViewModel, onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var response by rememberSaveable { mutableStateOf("") }
    val error by vm.answerError.collectAsStateWithLifecycle()
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Answer “$title”") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "The answer is saved on the question and recorded as a new decision hex.",
                    color = Hexes.colors.muted,
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = response,
                    onValueChange = { response = it },
                    label = { Text("Response (markdown)") },
                    minLines = 4,
                    isError = error != null,
                    supportingText = error?.let { { Text(it) } },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(onClick = { onSubmit(response) }, enabled = response.isNotBlank() && !busy) {
                Text(if (busy) "Saving…" else "Answer")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

/** An answered question's response, when it was given, and the decision it was recorded as. */
@Composable
private fun AnswerPanel(answer: String, meta: Map<String, String>, onOpenHex: (String) -> Unit) {
    val c = Hexes.colors
    val at = meta["answered_at"]?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Answer", style = MaterialTheme.typography.titleSmall, color = c.muted)
            MarkdownText(answer)
            at?.let { Text("answered ${dateTime(it)}", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall) }
            meta["decision"]?.let { id ->
                TextButton(onClick = { onOpenHex(id) }) { Text("Recorded as decision $id") }
            }
        }
    }
}

/** The status pill as a button: tap it to pick another status. */
@Composable
private fun StatusMenu(status: Status, options: List<Status>, enabled: Boolean, onPick: (Status) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.tappable("Change status", enabled) { open = true },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            StatusPill(status)
            Text("▾", color = Hexes.colors.muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { StatusPill(option) },
                    trailingIcon = { if (option == status) Text("✓") },
                    onClick = {
                        open = false
                        if (option != status) onPick(option)
                    },
                )
            }
        }
    }
}

@Composable
private fun EditTextCard(hex: Hex, vm: HexViewModel, editedFrom: Long, onClose: () -> Unit) {
    val c = Hexes.colors
    var title by rememberSaveable(hex.id, editedFrom) { mutableStateOf(hex.title) }
    var description by rememberSaveable(hex.id, editedFrom) { mutableStateOf(hex.description) }
    val error by vm.editError.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            label = { Text("Title") },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = description,
            onValueChange = { description = it },
            label = { Text("Description (markdown)") },
            minLines = 5,
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { e ->
            Text(e.message, color = MaterialTheme.colorScheme.error)
            if (e.stale) {
                Text(
                    "Saving anyway replaces what changed in the meantime.",
                    color = c.muted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.clearEditError(); onClose() }, enabled = !busy) { Text("Cancel") }
            Button(
                onClick = { vm.saveText(title, description, editedFrom, force = false, onSaved = onClose) },
                enabled = title.isNotBlank() && !busy,
            ) { Text(if (busy) "Saving…" else "Save") }
            if (error?.stale == true) {
                OutlinedButton(
                    onClick = { vm.saveText(title, description, editedFrom, force = true, onSaved = onClose) },
                    enabled = !busy,
                ) { Text("Save anyway") }
            }
        }
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
                        .tappable(enabled = !last) {
                            if (h.kind == "core.project") onOpenProject(h.id) else onOpenHex(h.id)
                        }
                        .padding(horizontal = 6.dp),
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
                        modifier = Modifier.tappable { onOpenHex(from.id) },
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
private fun MetaPanel(meta: Map<String, String>, busy: Boolean, vm: HexViewModel) {
    val c = Hexes.colors
    var adding by rememberSaveable { mutableStateOf(false) }
    var key by rememberSaveable { mutableStateOf("") }
    var value by rememberSaveable { mutableStateOf("") }
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Meta", style = MaterialTheme.typography.titleSmall, color = c.muted, modifier = Modifier.weight(1f))
                OutlinedButton(onClick = { adding = !adding }) { Text(if (adding) "Close" else "+ Add key") }
            }
            if (adding) {
                OutlinedTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = { Text("Key") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    label = { Text("Value") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        vm.setMeta(key, value) {
                            key = ""
                            value = ""
                            adding = false
                        }
                    },
                    enabled = key.isNotBlank() && !busy,
                ) { Text("Save") }
            }
            if (meta.isEmpty()) {
                Text("No meta keys.", color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
            }
            meta.forEach { (k, v) ->
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(k, color = c.muted, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                        Text(v, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                    }
                    Box(
                        Modifier.size(48.dp).clip(RoundedCornerShape(8.dp))
                            .clickable(enabled = !busy, role = Role.Button) { vm.removeMeta(k) }
                            .semantics { contentDescription = "Remove $k" },
                        contentAlignment = Alignment.Center,
                    ) { Text("✕", color = c.muted) }
                }
            }
        }
    }
}

/** Delete… → Continue → Delete forever, as on the web. */
@Composable
private fun DeletePanel(view: HexView, busy: Boolean, onConfirm: () -> Unit) {
    val c = Hexes.colors
    var step by rememberSaveable(view.hex.id) { mutableIntStateOf(0) }
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().border(BorderStroke(1.dp, c.dangerLine), shape).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Delete hex", style = MaterialTheme.typography.titleSmall, color = c.blocked)
        when (step) {
            0 -> {
                Text("Removes this hex from data.json. You'll be asked twice.", color = c.muted, style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { step = 1 }, modifier = Modifier.fillMaxWidth()) { Text("Delete…", color = c.blocked) }
            }
            1 -> {
                Text(deleteImpactText(view.deleteImpact), style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { step = 0 }, modifier = Modifier.weight(1f)) { Text("Cancel") }
                    OutlinedButton(onClick = { step = 2 }, modifier = Modifier.weight(1f)) { Text("Continue", color = c.blocked) }
                }
            }
            else -> {
                Text("Last check: permanently delete ${view.hex.id}?", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { step = 0 }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Keep it") }
                    Button(
                        onClick = onConfirm,
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = c.danger, contentColor = Color.White),
                        modifier = Modifier.weight(1f),
                    ) { Text(if (busy) "Deleting…" else "Delete forever") }
                }
            }
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
                        modifier = Modifier.tappable { onOpenHexFooter(h.id) },
                    )
                }
            }
        }
    }
}
