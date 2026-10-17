package dev.hexes.android.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

sealed interface Resource<out T> {
    data object Loading : Resource<Nothing>
    data class Failed(val message: String, val missing: Boolean = false) : Resource<Nothing>
    data class Ready<T>(val data: T) : Resource<T>
}

/**
 * Loads something once and reloads it whenever the server reports a change (`live` ticks).
 * Reloads are silent: the old data stays on screen. A reload that fails (say the file is
 * mid-write) is retried a few times before the error replaces the data, and a missing item
 * (404) shows its error straight away. This mirrors the web app's `useResource`.
 */
class ResourceLoader<T>(
    private val scope: CoroutineScope,
    live: Flow<Int>,
    private val retries: Int = 3,
    private val retryDelayMs: Long = 800,
    private val load: suspend () -> T,
) {
    private val _state = MutableStateFlow<Resource<T>>(Resource.Loading)
    val state: StateFlow<Resource<T>> = _state.asStateFlow()
    private var job: Job? = null

    init {
        refresh()
        // The first value is the current version, not a change.
        scope.launch { live.drop(1).collect { refresh() } }
    }

    /** Reloads without flashing "loading". Also what pull-to-refresh and retry buttons call. */
    fun refresh() {
        job?.cancel()
        job = scope.launch {
            var attempt = 0
            while (true) {
                try {
                    _state.value = Resource.Ready(load())
                    return@launch
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val hadData = _state.value is Resource.Ready
                    val missing = e is ApiException.Http && e.status == 404
                    if (hadData && !missing && attempt < retries) {
                        attempt++
                        delay(retryDelayMs)
                    } else {
                        _state.value = Resource.Failed(e.message ?: "Something went wrong.", missing)
                        return@launch
                    }
                }
            }
        }
    }
}
