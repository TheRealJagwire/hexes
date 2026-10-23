package dev.hexes.android.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/** Wire types of Studio's JSON API. They mirror src/shared/{schemas,views}.ts. */

/**
 * A hex status. A value this build does not know (from a newer Studio) parses to [Unknown] rather
 * than failing the whole response; [Unknown] is shown but never offered or sent.
 */
@Serializable(with = StatusSerializer::class)
enum class Status(val wire: String, val finished: Boolean = false) {
    Blocked("blocked"),
    Ready("ready"),
    InProgress("in_progress"),
    InReview("in_review"),
    Verified("verified"),
    Done("done", finished = true),
    Blessed("blessed"),
    Answered("answered", finished = true),
    PullRequested("pull_requested"),
    Merged("merged", finished = true),
    Closed("closed", finished = true),
    Unknown("unknown"),
    ;

    companion object {
        fun fromWire(wire: String): Status = entries.firstOrNull { it.wire == wire && it != Unknown } ?: Unknown
    }
}

object StatusSerializer : KSerializer<Status> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("dev.hexes.Status", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Status) = encoder.encodeString(value.wire)
    override fun deserialize(decoder: Decoder): Status = Status.fromWire(decoder.decodeString())
}

@Serializable
data class StatusInfo(val role: String, val satisfies: Boolean)

@Serializable
data class KindWorkflow(val statuses: List<Status>, val promoteTo: Status? = null)

/** `GET /api/statuses`: which statuses each kind allows. Mirrors `StatusTable` in views.ts. */
@Serializable
data class StatusTable(
    val statuses: Map<String, StatusInfo>,
    val kinds: Map<String, KindWorkflow>,
    val default: KindWorkflow,
    val requiresResponse: List<Status> = emptyList(),
    /** Statuses only pull requests set (`in_review`, `merged`); empty from an older Studio. */
    val derived: List<Status> = emptyList(),
) {
    fun allowed(kind: String): List<Status> = (kinds[kind] ?: default).statuses.filter { it != Status.Unknown }

    /** What a person can pick for `kind`: pull requests set the [derived] statuses, not people. */
    fun pickable(kind: String): List<Status> = allowed(kind).filter { it !in derived }

    /**
     * What the status menu offers a hex of `kind` that is now `current`. A status that can't be
     * picked (set by a pull request, or no longer allowed) stays listed so the menu can show it.
     * Picking one in [requiresResponse] asks for the response first.
     */
    fun options(kind: String, current: Status): List<Status> {
        val pickable = pickable(kind)
        return if (current in pickable || current == Status.Unknown) pickable else listOf(current) + pickable
    }

    companion object {
        private val DEFAULT = KindWorkflow(
            listOf(Status.Blocked, Status.Ready, Status.InProgress, Status.Verified, Status.Done),
            Status.Ready,
        )

        /** Used against a Studio from before `/api/statuses`: every kind had the default statuses. */
        val LEGACY = StatusTable(statuses = emptyMap(), kinds = emptyMap(), default = DEFAULT)
    }
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
    /** Required with `answered`: the answer to a question. */
    val response: String? = null,
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
    /** Absent from servers older than the Specs list. */
    val specs: List<HexSummary> = emptyList(),
    val decisions: List<HexSummary>,
    val questions: List<HexSummary>,
    val epics: List<EpicView>,
)

@Serializable
data class DeleteImpact(
    val dependents: Int,
    val emerged: Int,
    val projectHexes: Int?,
    /** Pull requests opened for this hex; they are kept, and lose their link to it. */
    val pullRequests: Int = 0,
)

/** A pull request as listed on its work hex. */
@Serializable
data class PullRequestSummary(
    val id: String,
    val title: String,
    val kind: String,
    val status: Status,
    val sourceBranch: String,
    val targetBranch: String,
    val mergeSha: String? = null,
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
    /** For a work hex: the branch its work is on, if started. */
    val workBranch: String? = null,
    /** For a work hex: its pull requests, newest first. */
    val pullRequests: List<PullRequestSummary> = emptyList(),
    /** For a pull request: the work hex it was opened for. */
    val workHex: HexSummary? = null,
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

/** `POST /api/hexes/:id/pull-requests`. */
@Serializable
data class OpenPullRequestRequest(val title: String? = null, val description: String? = null)

@Serializable
data class DiffLine(
    /** `context`, `add` or `del`. */
    val kind: String,
    val oldNo: Int? = null,
    val newNo: Int? = null,
    val text: String,
)

@Serializable
data class DiffHunk(val header: String, val lines: List<DiffLine>)

@Serializable
data class DiffFile(
    val path: String,
    val oldPath: String? = null,
    /** `added`, `deleted`, `renamed` or `modified`. */
    val status: String,
    val additions: Int,
    val deletions: Int,
    val binary: Boolean,
    val hunks: List<DiffHunk>,
)

/** `GET /api/hexes/:id/diff`. Mirrors `PullRequestDiff` in views.ts. */
@Serializable
data class PullRequestDiff(
    val files: List<DiffFile>,
    val truncated: Boolean,
    /** `git`, or `snapshot` when the commits are gone and the patch saved at merge time is used. */
    val source: String,
)

/** `GET /api/projects/recent`: a project opened before, in this folder or another. */
@Serializable
data class RecentProject(
    val dir: String,
    val projectId: String,
    val title: String,
    val folder: String,
    val openedAt: Long,
    val found: Boolean,
    val current: Boolean,
    val switchable: Boolean,
)

/** `POST /api/projects/open` and `/api/projects/recent/forget`. */
@Serializable
data class RecentProjectRequest(val dir: String, val projectId: String)
