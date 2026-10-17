package dev.hexes.android.ui.create

import dev.hexes.android.data.CreateHexRequest
import dev.hexes.android.data.HexSummary
import dev.hexes.android.data.Status

/** The kinds offered as chips; project hexes come from the new-project flow instead. */
val CREATE_KINDS: List<String> =
    listOf("design", "spec", "decision", "gate", "epic", "story", "substory", "bug", "question")
        .map { "core.$it" }

/** `blocked` first, as on the web: a new hex usually waits for something. */
val CREATE_STATUSES: List<Status> =
    listOf(Status.Blocked, Status.Ready, Status.InProgress, Status.Verified, Status.Done)

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

    fun toRequest(projectId: String): CreateHexRequest = CreateHexRequest(
        projectId = projectId,
        kind = effectiveKind,
        title = title.trim(),
        description = description,
        status = status,
        emergedFrom = emergedFrom?.id,
        requiredBy = requiredBy.map { it.id },
        dependsOn = dependsOn.map { it.id },
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
