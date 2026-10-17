package dev.hexes.android.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Wire types of Studio's JSON API. They mirror src/shared/{schemas,views}.ts. */

@Serializable
enum class Status(val wire: String) {
    @SerialName("blocked") Blocked("blocked"),
    @SerialName("ready") Ready("ready"),
    @SerialName("in_progress") InProgress("in_progress"),
    @SerialName("verified") Verified("verified"),
    @SerialName("done") Done("done"),
}

@Serializable
data class SelectProjectRequest(val id: String)

@Serializable
data class DirRequest(val dir: String)

/** `PATCH /api/hexes/:id`: only the fields that are set are sent. */
@Serializable
data class UpdateHexRequest(
    val title: String? = null,
    val description: String? = null,
    val status: Status? = null,
    /** The `lastUpdatedAtTimeInMs` the user saw; the server answers 409 if the hex has moved on. */
    val expectedUpdatedAtTimeInMs: Long? = null,
)

@Serializable
data class MetaValueRequest(val value: String)

@Serializable
data class DeleteResult(val deleted: List<String>)

@Serializable
data class Hex(
    val id: String,
    val title: String,
    val description: String,
    val kind: String,
    val createdAtTimeInMs: Long,
    val lastUpdatedAtTimeInMs: Long,
    val status: Status,
    val dependsOn: List<String> = emptyList(),
    val emergedFrom: String? = null,
    val meta: Map<String, String> = emptyMap(),
)

/** Compact hex reference used in lists, breadcrumbs and relationship panels. */
@Serializable
data class HexSummary(
    val id: String,
    val title: String,
    val kind: String,
    val status: Status,
)

@Serializable
data class Progress(val done: Int, val total: Int, val pct: Int)

@Serializable
data class WorkspaceState(
    val dir: String?,
    val pinned: Boolean,
    val lastDir: String?,
    val selectedProjectId: String?,
)

@Serializable
data class RecentWorkspace(
    val id: String,
    val label: String,
    val dir: String,
    val found: Boolean,
)

@Serializable
data class ProjectSummary(
    val id: String,
    val title: String,
    val blurb: String,
    val initial: String,
    val epics: Int,
    val stories: Int,
)

@Serializable
data class EpicView(
    val hex: Hex,
    val gate: HexSummary?,
    val progress: Progress,
    val stories: List<Hex>,
)

@Serializable
data class ProjectView(
    val project: Hex,
    val designs: List<HexSummary>,
    val decisions: List<HexSummary>,
    val questions: List<HexSummary>,
    val epics: List<EpicView>,
)

@Serializable
data class DeleteImpact(
    val dependents: Int,
    val emerged: Int,
    val projectHexes: Int?,
)

@Serializable
data class HexView(
    val hex: Hex,
    val breadcrumbs: List<HexSummary>,
    val projectId: String?,
    val dependsOn: List<HexSummary>,
    val dependedOnBy: List<HexSummary>,
    val emergedFromHex: HexSummary?,
    val emergedHere: List<HexSummary>,
    val deleteImpact: DeleteImpact,
)

@Serializable
data class ApiError(val error: String)

/** `POST /api/hexes`. No defaults on purpose: every field is always sent. */
@Serializable
data class CreateHexRequest(
    val projectId: String,
    val kind: String,
    val title: String,
    val description: String,
    val status: Status,
    val emergedFrom: String? = null,
    val requiredBy: List<String>,
    val dependsOn: List<String>,
    val meta: Map<String, String>,
)

@Serializable
data class CreateProjectRequest(
    val dir: String,
    val title: String,
    val description: String,
    val gitInit: Boolean,
)

@Serializable
data class CreateProjectResult(val projectId: String, val warnings: List<String>)
