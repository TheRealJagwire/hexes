package dev.hexes.android.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class LiveUpdatesTest {
    private lateinit var server: MockWebServer

    @Before
    fun start() {
        server = MockWebServer().also { it.start() }
    }

    @After
    fun stop() = server.close()

    private fun sse(vararg events: String) =
        MockResponse.Builder().code(200).addHeader("Content-Type", "text/event-stream")
            .body(events.joinToString("") { "event: $it\ndata: {}\n\n" }).build()

    @Test
    fun changesAndReconnectsBumpTheVersion() = runBlocking {
        server.enqueue(sse("hello", "change")) // +1 for the change, then the stream ends
        server.enqueue(sse("hello")) // reconnect: +1 because changes may have been missed
        val connection = Connection.parse(server.url("/").toString(), "tok")
        val live = LiveUpdates(MutableStateFlow(connection), initialBackoffMs = 10, maxBackoffMs = 20)
        val job = launch { live.run() }
        try {
            withTimeout(10_000) { live.version.first { it >= 2 } }
            assertEquals(2, live.version.value)
            val request = server.takeRequest()
            assertEquals("/api/events", request.url.encodedPath)
            assertEquals("Bearer tok", request.headers["Authorization"])
            assertEquals("text/event-stream", request.headers["Accept"])
        } finally {
            job.cancel()
        }
    }

    @Test
    fun idleWithoutAConnection() = runBlocking {
        val live = LiveUpdates(MutableStateFlow(null))
        val job = launch { live.run() }
        try {
            assertEquals(LiveStatus.Idle, live.status.value)
        } finally {
            job.cancel()
        }
    }
}
