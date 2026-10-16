package dev.hexes.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {
    private val now = 1_700_000_000_000L

    @Test
    fun relativeTimeBuckets() {
        assertEquals("just now", relativeTime(now - 30_000, now))
        assertEquals("5m ago", relativeTime(now - 5 * 60_000, now))
        assertEquals("3h ago", relativeTime(now - 3 * 3_600_000L, now))
        assertEquals("2d ago", relativeTime(now - 2 * 86_400_000L, now))
        assertEquals("4mo ago", relativeTime(now - 125 * 86_400_000L, now))
        assertEquals("2y ago", relativeTime(now - 800 * 86_400_000L, now))
        assertEquals("just now", relativeTime(now + 5_000, now)) // clock skew never goes negative
    }

    @Test
    fun pluralMatchesTheWebApp() {
        assertEquals("1 epic", plural(1, "epic"))
        assertEquals("0 epics", plural(0, "epic"))
        assertEquals("3 stories", plural(3, "story"))
        assertEquals("1 story", plural(1, "story"))
    }

    @Test
    fun statusSummaryIsInLifecycleOrder() {
        val statuses = listOf(Status.Blocked, Status.Done, Status.Done, Status.InProgress)
        assertEquals("2 done · 1 in progress · 1 blocked", statusSummary(statuses))
        assertEquals("", statusSummary(emptyList()))
    }

    @Test
    fun kindQualifier() {
        assertEquals("story", kindQualifier("core.story"))
        assertEquals("odd", kindQualifier("odd"))
    }
}
