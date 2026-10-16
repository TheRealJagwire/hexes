package dev.hexes.android.data

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Where Studio is and how to authenticate. The token is empty for loopback / `adb reverse`. */
data class Connection(val baseUrl: HttpUrl, val token: String) {
    companion object {
        /** Accepts `host:8000`, `http://host:8000/` and similar; returns null if unusable. */
        fun parse(rawUrl: String, token: String): Connection? {
            val text = rawUrl.trim()
            if (text.isEmpty()) return null
            val withScheme = if (text.contains("://")) text else "http://$text"
            val url = withScheme.toHttpUrlOrNull() ?: return null
            return Connection(url, token.trim())
        }
    }
}
