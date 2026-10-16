package dev.hexes.android.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collectLatest
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.util.concurrent.TimeUnit

enum class LiveStatus { Idle, Connecting, Live, Reconnecting }

/**
 * Follows Studio's `/api/events` stream. `version` goes up on every change and after every
 * reconnect (changes may have been missed), which is what makes screens refetch.
 */
class LiveUpdates(
    private val connections: Flow<Connection?>,
    http: okhttp3.OkHttpClient = defaultHttpClient(),
    private val initialBackoffMs: Long = 1_000,
    private val maxBackoffMs: Long = 15_000,
) {
    // The server pings every 20 s, so a quiet minute means the connection is dead.
    private val streamClient = http.newBuilder().readTimeout(60, TimeUnit.SECONDS).build()

    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version.asStateFlow()

    private val _status = MutableStateFlow(LiveStatus.Idle)
    val status: StateFlow<LiveStatus> = _status.asStateFlow()

    /** Runs until cancelled. Call it only while the app is in the foreground. */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun run() {
        connections.collectLatest { connection ->
            if (connection == null) {
                _status.value = LiveStatus.Idle
                return@collectLatest
            }
            follow(ApiClient(connection, streamClient))
        }
    }

    private suspend fun follow(client: ApiClient) {
        var opened = false
        var backoff = initialBackoffMs
        _status.value = LiveStatus.Connecting
        while (true) {
            try {
                events(client).collect { type ->
                    when (type) {
                        "hello" -> {
                            _status.value = LiveStatus.Live
                            backoff = initialBackoffMs
                            if (opened) _version.value++
                            opened = true
                        }
                        "change" -> _version.value++
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // fall through to the reconnect below
            }
            _status.value = if (opened) LiveStatus.Reconnecting else LiveStatus.Connecting
            delay(backoff)
            backoff = minOf(backoff * 2, maxBackoffMs)
        }
    }

    private fun events(client: ApiClient): Flow<String> = callbackFlow {
        val listener = object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (type != null) trySend(type)
            }

            override fun onClosed(eventSource: EventSource) {
                close(IOException("event stream closed"))
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                close(t ?: IOException("event stream failed (${response?.code})"))
            }
        }
        val source = EventSources.createFactory(streamClient).newEventSource(client.eventsRequest(), listener)
        awaitClose { source.cancel() }
    }
}
