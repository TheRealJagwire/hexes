package dev.hexes.android.ui.create

import dev.hexes.android.data.HexSummary
import dev.hexes.android.data.KindWorkflow
import dev.hexes.android.data.Status
import dev.hexes.android.data.StatusTable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CreateHexFormTest {
    private fun hex(id: String, title: String = id, status: Status = Status.Ready) =
        HexSummary(id, title, "core.story", status)

    @Test
    fun needsATitleAndAKind() {
        assertFalse(CreateHexForm().canSubmit)
        assertFalse(CreateHexForm(title = "   ").canSubmit)
        assertTrue(CreateHexForm(title = "Draw the grid").canSubmit)
        assertFalse(CreateHexForm(title = "x", kind = "", customKind = "").canSubmit)
    }

    @Test
    fun aCustomKindWinsOverTheChips() {
        assertEquals("core.story", CreateHexForm().effectiveKind)
        assertEquals("studio.note", CreateHexForm(customKind = "  studio.note ").effectiveKind)
        assertEquals("core.bug", CreateHexForm(kind = "core.bug", customKind = "   ").effectiveKind)
    }

    @Test
    fun theRequestCarriesEverythingTheServerNeeds() {
        val form = CreateHexForm(
            kind = "core.epic",
            title = "  Board  ",
            description = "## Goals",
            status = Status.Ready,
            emergedFrom = hex("hx-a-001"),
            requiredBy = listOf(hex("hx-a-002")),
            dependsOn = listOf(hex("hx-a-003"), hex("hx-a-004")),
            meta = listOf(MetaRow(" git_branch ", "feat/x"), MetaRow("", "ignored"), MetaRow("  ", "also ignored")),
        )
        val req = form.toRequest("hx-a-000")
        assertEquals("hx-a-000", req.projectId)
        assertEquals("core.epic", req.kind)
        assertEquals("Board", req.title)
        assertEquals("## Goals", req.description)
        assertEquals(Status.Ready, req.status)
        assertEquals("hx-a-001", req.emergedFrom)
        assertEquals(listOf("hx-a-002"), req.requiredBy)
        assertEquals(listOf("hx-a-003", "hx-a-004"), req.dependsOn)
        assertEquals(mapOf("git_branch" to "feat/x"), req.meta)
    }

    @Test
    fun aLaterMetaRowOverridesAnEarlierOneWithTheSameKey() {
        val req = CreateHexForm(title = "t", meta = listOf(MetaRow("k", "1"), MetaRow("k", "2"))).toRequest("p")
        assertEquals(mapOf("k" to "2"), req.meta)
    }

    @Test
    fun nothingEmergedMeansNoEmergedFrom() {
        assertNull(CreateHexForm(title = "t").toRequest("p").emergedFrom)
    }

    @Test
    fun newHexesStartBlockedAndTheStatusListLeadsWithIt() {
        assertEquals(Status.Blocked, CreateHexForm().status)
        val options = CreateHexForm().statusOptions(StatusTable.LEGACY)
        assertEquals(Status.Blocked, options.first())
        assertEquals(setOf(Status.Blocked, Status.Ready, Status.InProgress, Status.Verified, Status.Done), options.toSet())
    }

    private val table = StatusTable(
        statuses = emptyMap(),
        kinds = mapOf(
            "core.design" to KindWorkflow(listOf(Status.Blocked, Status.InProgress, Status.Blessed, Status.Done)),
            "core.question" to KindWorkflow(listOf(Status.Blocked, Status.Ready, Status.InProgress, Status.Answered), Status.Ready),
        ),
        default = KindWorkflow(listOf(Status.Blocked, Status.Ready, Status.InProgress, Status.Verified, Status.Done), Status.Ready),
        requiresResponse = listOf(Status.Answered),
    )

    @Test
    fun statusesFollowTheKindAndLeaveOutOnesThatNeedAResponse() {
        assertEquals(
            listOf(Status.Blocked, Status.InProgress, Status.Blessed, Status.Done),
            CreateHexForm(kind = "core.design").statusOptions(table),
        )
        assertEquals(
            listOf(Status.Blocked, Status.Ready, Status.InProgress),
            CreateHexForm(kind = "core.question").statusOptions(table),
        )
    }

    @Test
    fun switchingToAKindWithoutTheChosenStatusFallsBackToBlocked() {
        val form = CreateHexForm(kind = "core.design", title = "t", status = Status.Ready)
        assertEquals(Status.Blocked, form.effectiveStatus(table))
        assertEquals(Status.Blocked, form.toRequest("p", table).status)
        assertEquals(Status.Blessed, form.copy(status = Status.Blessed).toRequest("p", table).status)
    }

    @Test
    fun theKindChipsAreCoreKindsWithoutProject() {
        assertTrue("core.story" in CREATE_KINDS)
        assertTrue("core.question" in CREATE_KINDS)
        assertFalse("core.project" in CREATE_KINDS)
    }

    @Test
    fun searchMatchesIdOrTitleAndSkipsChosenHexes() {
        val options = listOf(hex("hx-a-001", "Draw the grid"), hex("hx-a-002", "Fog of war"), hex("hx-a-0f3", "Netcode"))
        assertEquals(listOf("hx-a-001"), searchHexes(options, "GRID", emptySet()).map { it.id })
        assertEquals(listOf("hx-a-0f3"), searchHexes(options, "0f3", emptySet()).map { it.id })
        assertEquals(3, searchHexes(options, "", emptySet()).size)
        assertEquals(listOf("hx-a-002", "hx-a-0f3"), searchHexes(options, "", setOf("hx-a-001")).map { it.id })
        assertEquals(1, searchHexes(options, "", emptySet(), limit = 1).size)
        assertTrue(searchHexes(options, "zzz", emptySet()).isEmpty())
    }
}
