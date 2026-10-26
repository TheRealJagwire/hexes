package dev.hexes.android.ui.create

import dev.hexes.android.data.CreateHexRequest
import dev.hexes.android.data.HexSummary
import dev.hexes.android.data.IDEA_KIND
import dev.hexes.android.data.Status
import dev.hexes.android.data.StatusTable

/** The kinds offered as chips; project hexes come from the new-project flow instead. */
val CREATE_KINDS: List<String> =
    listOf("idea", "design", "spec", "decision", "gate", "epic", "story", "substory", "bug", "question")
        .map { "core.$it" }

data class MetaRow(val key: String = "", val value: String = "")

/** Everything typed into the create screen, and how it becomes a request. */
data class CreateHexForm(
    val kind: String = "core.story",
    val customKind: String = "",
    val title: String = "",
    val description: String = "",
    val status: Status = Status.Blocked,
    val emergedFrom: HexSummary? = null,
    val requiredBy: List<HexSummary> = emptyList(),
    val dependsOn: List<HexSummary> = emptyList(),
    val meta: List<MetaRow> = emptyList(),
) {
    /** A typed custom kind wins over the chips. */
    val effectiveKind: String get() = customKind.trim().ifEmpty { kind }

    val canSubmit: Boolean get() = title.isNotBlank() && effectiveKind.isNotEmpty()

    /**
     * The statuses a new hex of this kind can start in, `blocked` first as on the web. Ones that
     * need a response (answering a question) are set after creating it, and an idea always starts
     * as a draft.
     */
    fun statusOptions(table: StatusTable): List<Status> =
        if (effectiveKind == IDEA_KIND) {
            listOf(Status.Draft)
        } else {
            table.pickable(effectiveKind).filter { it !in table.requiresResponse }
        }

    /** The chosen status, or the kind's first one (usually `blocked`) when switching kind made it unavailable. */
    fun effectiveStatus(table: StatusTable): Status =
        status.takeIf { it in statusOptions(table) } ?: statusOptions(table).firstOrNull() ?: Status.Blocked

    fun toRequest(projectId: String, table: StatusTable = StatusTable.LEGACY): CreateHexRequest = CreateHexRequest(
        projectId = projectId,
        kind = effectiveKind,
        title = title.trim(),
        description = description,
        status = effectiveStatus(table),
        emergedFrom = emergedFrom?.id,
        requiredBy = requiredBy.map { it.id },
        // An idea always hangs off its project, so it shows on the project screen.
        dependsOn = ((if (effectiveKind == IDEA_KIND) listOf(projectId) else emptyList()) + dependsOn.map { it.id })
            .distinct(),
        // Rows without a key are ignored; later rows win over earlier ones with the same key.
        meta = meta.filter { it.key.isNotBlank() }.associate { it.key.trim() to it.value },
    )
}

/** Hexes matching a search, not already chosen; at most `limit`. */
fun searchHexes(options: List<HexSummary>, query: String, taken: Set<String>, limit: Int = 30): List<HexSummary> {
    val needle = query.trim().lowercase()
    return options.asSequence()
        .filter { it.id !in taken }
        .filter { needle.isEmpty() || it.id.contains(needle) || it.title.lowercase().contains(needle) }
        .take(limit)
        .toList()
}
