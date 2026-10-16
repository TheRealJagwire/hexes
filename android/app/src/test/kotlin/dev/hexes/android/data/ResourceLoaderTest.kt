package dev.hexes.android.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class ResourceLoaderTest {
    private fun loader(
        scope: TestScope,
        live: MutableStateFlow<Int>,
        load: suspend () -> String,
    ): ResourceLoader<String> {
        // backgroundScope is not driven by advanceUntilIdle in this coroutines-test, so use our own
        // scope on the test scheduler. It is never left running: the scheduler is virtual.
        val ownScope = CoroutineScope(StandardTestDispatcher(scope.testScheduler) + SupervisorJob())
        return ResourceLoader(ownScope, live, retries = 3, retryDelayMs = 800, load = load)
    }

    @Test
    fun loadsOnce() = runTest(StandardTestDispatcher()) {
        val r = loader(this, MutableStateFlow(0)) { "hello" }
        assertEquals(Resource.Loading, r.state.value)
        advanceUntilIdle()
        assertEquals(Resource.Ready("hello"), r.state.value)
    }

    @Test
    fun aLiveTickReloadsWithoutShowingLoading() = runTest(StandardTestDispatcher()) {
        val live = MutableStateFlow(0)
        var n = 0
        val r = loader(this, live) { "v${++n}" }
        advanceUntilIdle()
        assertEquals(Resource.Ready("v1"), r.state.value)
        live.value = 1
        advanceUntilIdle()
        assertEquals(Resource.Ready("v2"), r.state.value)
    }

    @Test
    fun theVersionAlreadyThereIsNotAChange() = runTest(StandardTestDispatcher()) {
        var n = 0
        loader(this, MutableStateFlow(7)) { "v${++n}" }
        advanceUntilIdle()
        assertEquals(1, n)
    }

    @Test
    fun aFailedReloadKeepsTheDataAndRetries() = runTest(StandardTestDispatcher()) {
        val live = MutableStateFlow(0)
        var calls = 0
        val r = loader(this, live) {
            calls++
            if (calls == 2) throw IOException("mid-write") else "ok$calls"
        }
        advanceUntilIdle()
        live.value = 1
        advanceTimeBy(100) // the failing reload has run; the retry is waiting
        assertEquals(Resource.Ready("ok1"), r.state.value) // old data still shown
        advanceUntilIdle()
        assertEquals(Resource.Ready("ok3"), r.state.value)
    }

    @Test
    fun aReloadThatKeepsFailingEventuallyShowsTheError() = runTest(StandardTestDispatcher()) {
        val live = MutableStateFlow(0)
        var calls = 0
        val r = loader(this, live) {
            if (++calls == 1) "ok" else throw IOException("still broken")
        }
        advanceUntilIdle()
        live.value = 1
        advanceUntilIdle()
        assertTrue(r.state.value is Resource.Failed)
        assertEquals(1 + 1 + 3, calls) // first load, failing reload, three retries
    }

    @Test
    fun aFirstLoadFailureShowsImmediately() = runTest(StandardTestDispatcher()) {
        var calls = 0
        val r = loader(this, MutableStateFlow(0)) { calls++; throw IOException("down") }
        advanceUntilIdle()
        assertEquals(Resource.Failed("down"), r.state.value)
        assertEquals(1, calls)
    }

    @Test
    fun aMissingItemIsNotRetried() = runTest(StandardTestDispatcher()) {
        val live = MutableStateFlow(0)
        var calls = 0
        val r = loader(this, live) {
            if (++calls == 1) "here" else throw ApiException.Http(404, "No hex with id x")
        }
        advanceUntilIdle()
        live.value = 1
        advanceUntilIdle()
        assertEquals(Resource.Failed("No hex with id x"), r.state.value)
        assertEquals(2, calls)
    }

    @Test
    fun refreshRecoversFromAnError() = runTest(StandardTestDispatcher()) {
        var fail = true
        val r = loader(this, MutableStateFlow(0)) { if (fail) throw IOException("down") else "back" }
        advanceUntilIdle()
        assertTrue(r.state.value is Resource.Failed)
        fail = false
        r.refresh()
        advanceUntilIdle()
        assertEquals(Resource.Ready("back"), r.state.value)
    }
}
