package dev.hexes.android.data

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parses Studio's golden API responses (shared with the server's tests) with a strict decoder:
 * a new field on the server that the app does not model fails here instead of silently vanishing.
 */
class ContractParsingTest {
    private val strict = Json { ignoreUnknownKeys = false }

    private fun fixture(name: String): Pair<Int, String> {
        val text = javaClass.classLoader!!.getResourceAsStream("contract/$name.json")!!
            .bufferedReader().readText()
        val root = strict.parseToJsonElement(text).jsonObject
        return root.getValue("status").jsonPrimitive.int to root.getValue("body").toString()
    }

    private fun <T> parse(name: String, serializer: DeserializationStrategy<T>, status: Int = 200): T {
        val (code, body) = fixture(name)
        assertEquals("status of $name", status, code)
        return strict.decodeFromString(serializer, body)
    }

    @Test
    fun state() {
        val s = parse("state", WorkspaceState.serializer())
        assertEquals(false, s.pinned)
        assertNotNull(s.selectedProjectId)
    }

    @Test
    fun projects() {
        val list = parse("projects", ListSerializer(ProjectSummary.serializer()))
        assertEquals("Contract Demo", list.single().title)
    }

    @Test
    fun projectView() {
        val v = parse("project_view", ProjectView.serializer())
        assertEquals("core.project", v.project.kind)
        assertEquals(Status.Ready, v.epics.single().stories.single().status)
        assertEquals(1, v.questions.size)
        assertTrue(v.designs.single().status == Status.Done)
    }

    @Test
    fun hexView() {
        val v = parse("hex_view", HexView.serializer())
        assertEquals("feat/grid", v.hex.meta["git_branch"])
        assertEquals(v.hex.id, v.breadcrumbs.last().id)
        assertEquals(null, v.deleteImpact.projectHexes)
    }

    @Test
    fun hexSearch() {
        val list = parse("hex_search", ListSerializer(HexSummary.serializer()))
        assertTrue(list.isNotEmpty())
    }

    @Test
    fun recentWorkspaces() {
        val list = parse("recent_workspaces", ListSerializer(RecentWorkspace.serializer()))
        assertTrue(list.single().found)
    }

    @Test
    fun updatedHex() {
        assertEquals("Board (v1)", parse("update_hex", Hex.serializer()).title)
    }

    @Test
    fun errors() {
        assertEquals("No hex with id hx-nope-000", parse("error_not_found", ApiError.serializer(), 404).error)
        assertEquals(409, fixture("error_stale_edit").first)
        parse("error_stale_edit", ApiError.serializer(), 409)
    }
}
