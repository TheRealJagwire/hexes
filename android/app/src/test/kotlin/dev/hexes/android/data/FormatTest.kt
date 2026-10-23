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
        assertEquals("2 hexes", plural(2, "hex"))
        assertEquals("1 hex", plural(1, "hex"))
    }

    @Test
    fun deleteImpactIsWorded() {
        assertEquals(
            "Nothing else references this hex.",
            deleteImpactText(DeleteImpact(dependents = 0, emerged = 0, projectHexes = null)),
        )
        assertEquals(
            "1 hex depends on this one and 0 emerged from it. Their references will be removed.",
            deleteImpactText(DeleteImpact(1, 0, null)),
        )
        assertEquals(
            "3 hexes depend on this one and 2 emerged from it. Their references will be removed.",
            deleteImpactText(DeleteImpact(3, 2, null)),
        )
        assertEquals(
            "This deletes the project and all 12 hexes in it.",
            deleteImpactText(DeleteImpact(0, 0, 12)),
        )
    }

    @Test
    fun statusSummaryIsInLifecycleOrder() {
        val statuses = listOf(Status.Blocked, Status.Done, Status.Done, Status.InProgress)
        assertEquals("2 done · 1 in progress · 1 blocked", statusSummary(statuses))
        assertEquals("", statusSummary(emptyList()))
        assertEquals(
            "2 merged · 1 in review · 1 in progress",
            statusSummary(listOf(Status.InProgress, Status.InReview, Status.Merged, Status.Merged)),
        )
    }

    @Test
    fun kindQualifier() {
        assertEquals("story", kindQualifier("core.story"))
        assertEquals("odd", kindQualifier("odd"))
    }
}
