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
