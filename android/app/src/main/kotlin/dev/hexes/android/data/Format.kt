package dev.hexes.android.data

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Display helpers that mirror the web app's format.ts and graph.ts. */

fun kindQualifier(kind: String): String = kind.split(".").getOrNull(1) ?: kind

/** "just now", "5m ago", "3h ago", "2d ago", "4mo ago", "1y ago". */
fun relativeTime(ms: Long, now: Long = System.currentTimeMillis()): String {
    val secs = maxOf(0L, (now - ms + 500) / 1000)
    if (secs < 60) return "just now"
    val mins = secs / 60
    if (mins < 60) return "${mins}m ago"
    val hours = mins / 60
    if (hours < 24) return "${hours}h ago"
    val days = hours / 24
    if (days < 30) return "${days}d ago"
    if (days < 365) return "${days / 30}mo ago"
    return "${days / 365}y ago"
}

fun dateTime(ms: Long): String =
    SimpleDateFormat("MMM d, yyyy, HH:mm", Locale.US).format(Date(ms))

fun plural(n: Int, word: String): String = when {
    n == 1 -> "1 $word"
    word.endsWith("y") -> "$n ${word.dropLast(1)}ies"
    else -> "$n ${word}s"
}

/** "2 done · 1 in progress", in status-lifecycle order. */
fun statusSummary(statuses: List<Status>): String {
    val order = listOf(Status.Done, Status.Verified, Status.InProgress, Status.Ready, Status.Blocked)
    return order.mapNotNull { status ->
        val n = statuses.count { it == status }
        if (n > 0) "$n ${status.wire.replace('_', ' ')}" else null
    }.joinToString(" · ")
}
