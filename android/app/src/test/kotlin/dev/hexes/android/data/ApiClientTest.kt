package dev.hexes.android.data

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    private lateinit var server: MockWebServer

    @Before
    fun start() {
        server = MockWebServer().also { it.start() }
    }

    @After
    fun stop() = server.close()

    private fun client(token: String = "") =
        ApiClient(Connection.parse(server.url("/").toString(), token)!!)

    private fun ok(body: String, version: String? = "1") =
        MockResponse.Builder().code(200).body(body).apply {
            if (version != null) addHeader("X-Hexes-Api", version)
        }.build()

    @Test
    fun healthChecksTheVersionHeaderAndSendsTheToken() = runBlocking {
        server.enqueue(ok("""{"ok":true}"""))
        assertEquals(1, client("secret-token").health())
        val request = server.takeRequest()
        assertEquals("/api/health", request.url.encodedPath)
        assertEquals("Bearer secret-token", request.headers["Authorization"])
    }

    @Test
    fun noAuthorizationHeaderWithoutAToken() = runBlocking {
        server.enqueue(ok("""{"ok":true}"""))
        client().health()
        assertNull(server.takeRequest().headers["Authorization"])
    }

    @Test
    fun aDifferentApiVersionIsReported() = runBlocking {
        server.enqueue(ok("""{"ok":true}""", version = "2"))
        try {
            client().health()
            fail("expected a version mismatch")
        } catch (e: ApiException.VersionMismatch) {
            assertEquals(2, e.server)
        }
    }

    @Test
    fun aServerWithoutTheHeaderIsNotStudio() = runBlocking {
        server.enqueue(ok("""{"ok":true}""", version = null))
        try {
            client().health()
            fail("expected a version mismatch")
        } catch (e: ApiException.VersionMismatch) {
            assertNull(e.server)
        }
    }

    @Test
    fun unauthorizedIsItsOwnError() = runBlocking {
        server.enqueue(
            MockResponse.Builder().code(401).body("""{"error":"missing or invalid token"}""").build(),
        )
        try {
            client().health()
            fail("expected unauthorized")
        } catch (e: ApiException.Unauthorized) {
            assertEquals("missing or invalid token", e.message)
        }
    }

    @Test
    fun serverErrorTextIsPassedThrough() = runBlocking {
        server.enqueue(MockResponse.Builder().code(422).body("""{"error":"data.json is not valid"}""").build())
        try {
            client().state()
            fail("expected an http error")
        } catch (e: ApiException.Http) {
            assertEquals(422, e.status)
            assertEquals("data.json is not valid", e.message)
        }
    }

    @Test
    fun stateAndProjectsParse() = runBlocking {
        server.enqueue(ok("""{"dir":"/x","pinned":false,"lastDir":"/x","selectedProjectId":null}"""))
        server.enqueue(ok("""[{"id":"hx-a-123","title":"A","blurb":"","initial":"A","epics":0,"stories":2}]"""))
        assertEquals("/x", client().state().dir)
        assertEquals(2, client().projects().single().stories)
    }

    @Test
    fun hexIdsAreEscapedInThePath() = runBlocking {
        server.enqueue(MockResponse.Builder().code(404).body("""{"error":"No hex with id a/b c"}""").build())
        try {
            client().hex("a/b c")
            fail("expected 404")
        } catch (e: ApiException.Http) {
            assertEquals(404, e.status)
        }
        assertEquals("/api/hexes/a%2Fb%20c", server.takeRequest().url.encodedPath)
    }

    @Test
    fun selectingAProjectPostsJson() = runBlocking {
        server.enqueue(ok("""{"ok":true}"""))
        client().selectProject("hx-a-123")
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/selected-project", request.url.encodedPath)
        assertTrue(request.headers["Content-Type"]!!.startsWith("application/json"))
        assertEquals("""{"id":"hx-a-123"}""", request.body!!.utf8())
    }

    @Test
    fun openingAWorkspaceReturnsTheNewState() = runBlocking {
        server.enqueue(ok("""{"dir":"/p","pinned":false,"lastDir":"/p","selectedProjectId":null}"""))
        assertEquals("/p", client().openWorkspace("~/p").dir)
        assertEquals("""{"dir":"~/p"}""", server.takeRequest().body!!.utf8())
    }

    @Test
    fun updatingAHexPatchesOnlyTheFieldsSet() = runBlocking {
        server.enqueue(ok("""{"id":"hx-a-123","title":"T","description":"","kind":"core.story","createdAtTimeInMs":1,"lastUpdatedAtTimeInMs":2,"status":"ready"}"""))
        val hex = client().updateHex("hx-a-123", UpdateHexRequest(status = Status.InProgress))
        assertEquals("hx-a-123", hex.id)
        val request = server.takeRequest()
        assertEquals("PATCH", request.method)
        assertEquals("/api/hexes/hx-a-123", request.url.encodedPath)
        assertEquals("""{"status":"in_progress"}""", request.body!!.utf8())
    }

    @Test
    fun aTextEditCarriesTheVersionItWasOpenedOn() = runBlocking {
        server.enqueue(ok("""{"id":"hx-a-123","title":"T","description":"","kind":"core.story","createdAtTimeInMs":1,"lastUpdatedAtTimeInMs":2,"status":"ready"}"""))
        client().updateHex("hx-a-123", UpdateHexRequest(title = "New", description = "Body", expectedUpdatedAtTimeInMs = 42))
        assertEquals(
            """{"title":"New","description":"Body","expectedUpdatedAtTimeInMs":42}""",
            server.takeRequest().body!!.utf8(),
        )
    }

    @Test
    fun aStaleEditIsAConflict() = runBlocking {
        server.enqueue(MockResponse.Builder().code(409).body("""{"error":"This hex was changed elsewhere. Reload it and try again."}""").build())
        try {
            client().updateHex("hx-a-123", UpdateHexRequest(title = "x", expectedUpdatedAtTimeInMs = 1))
            fail("expected a conflict")
        } catch (e: ApiException.Http) {
            assertEquals(409, e.status)
            assertTrue(e.message!!.contains("changed elsewhere"))
        }
    }

    @Test
    fun metaKeysAreSetAndRemovedByPath() = runBlocking {
        server.enqueue(ok("""{"id":"hx-a-123","title":"T","description":"","kind":"core.story","createdAtTimeInMs":1,"lastUpdatedAtTimeInMs":2,"status":"ready"}"""))
        server.enqueue(ok("""{"id":"hx-a-123","title":"T","description":"","kind":"core.story","createdAtTimeInMs":1,"lastUpdatedAtTimeInMs":2,"status":"ready"}"""))
        client().setMeta("hx-a-123", "git branch", "feat/x")
        client().removeMeta("hx-a-123", "git branch")
        val put = server.takeRequest()
        assertEquals("PUT", put.method)
        assertEquals("/api/hexes/hx-a-123/meta/git%20branch", put.url.encodedPath)
        assertEquals("""{"value":"feat/x"}""", put.body!!.utf8())
        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method)
        assertEquals("/api/hexes/hx-a-123/meta/git%20branch", delete.url.encodedPath)
    }

    @Test
    fun deletingReturnsEveryRemovedId() = runBlocking {
        server.enqueue(ok("""{"deleted":["hx-a-123","hx-a-456"]}"""))
        assertEquals(listOf("hx-a-123", "hx-a-456"), client().deleteHex("hx-a-123"))
        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/api/hexes/hx-a-123", request.url.encodedPath)
    }

    @Test
    fun createHexPostsEveryField() = runBlocking {
        server.enqueue(MockResponse.Builder().code(201).addHeader("X-Hexes-Api", "1").body("""{"id":"hx-a-123","title":"T","description":"","kind":"core.story","createdAtTimeInMs":1,"lastUpdatedAtTimeInMs":2,"status":"blocked"}""").build())
        val created = client().createHex(
            CreateHexRequest(
                projectId = "hx-a-000", kind = "core.story", title = "T", description = "", status = Status.Blocked,
                emergedFrom = null, requiredBy = emptyList(), dependsOn = listOf("hx-a-001"), meta = mapOf("k" to "v"),
            ),
        )
        assertEquals("hx-a-123", created.id)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/hexes", request.url.encodedPath)
        assertEquals(
            """{"projectId":"hx-a-000","kind":"core.story","title":"T","description":"","status":"blocked","requiredBy":[],"dependsOn":["hx-a-001"],"meta":{"k":"v"}}""",
            request.body!!.utf8(),
        )
    }

    @Test
    fun projectHexesKeepsTheQueryString() = runBlocking {
        server.enqueue(ok("""[{"id":"hx-a-1","title":"A","kind":"core.story","status":"ready"}]"""))
        assertEquals("A", client().projectHexes("hx-a-000").single().title)
        val url = server.takeRequest().url
        assertEquals("/api/hexes", url.encodedPath)
        assertEquals("hx-a-000", url.queryParameter("project"))
        assertEquals("1000", url.queryParameter("limit"))
    }

    @Test
    fun createProjectReturnsItsWarnings() = runBlocking {
        server.enqueue(MockResponse.Builder().code(201).addHeader("X-Hexes-Api", "1").body("""{"projectId":"hx-p-abc","warnings":["git init failed"]}""").build())
        val res = client().createProject(CreateProjectRequest("~/p", "P", "Statement", gitInit = true))
        assertEquals("hx-p-abc", res.projectId)
        assertEquals(listOf("git init failed"), res.warnings)
        val request = server.takeRequest()
        assertEquals("/api/workspace/create", request.url.encodedPath)
        assertEquals("""{"dir":"~/p","title":"P","description":"Statement","gitInit":true}""", request.body!!.utf8())
    }

    @Test
    fun aValidationErrorIsShownAsTheServerSaidIt() = runBlocking {
        server.enqueue(MockResponse.Builder().code(400).body("""{"error":"kind: expected <category>.<qualifier>, e.g. core.story"}""").build())
        try {
            client().createHex(CreateHexRequest("p", "bad", "T", "", Status.Blocked, null, emptyList(), emptyList(), emptyMap()))
            fail("expected a 400")
        } catch (e: ApiException.Http) {
            assertEquals(400, e.status)
            assertTrue(e.message!!.startsWith("kind:"))
        }
    }

    @Test
    fun garbageIsABadResponse() = runBlocking {
        server.enqueue(ok("<html>not json</html>"))
        try {
            client().state()
            fail("expected a bad response")
        } catch (e: ApiException.BadResponse) {
            assertTrue(e.message!!.contains("Unexpected"))
        }
    }

    @Test
    fun anUnreachableServerIsReported() = runBlocking {
        val c = client()
        server.close()
        try {
            c.state()
            fail("expected unreachable")
        } catch (e: ApiException.Unreachable) {
            // expected
        }
    }
}
