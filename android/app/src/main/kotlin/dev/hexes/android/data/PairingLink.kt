package dev.hexes.android.data

import java.net.URLDecoder

/** What Studio prints for pairing: `hexes://pair?url=<server url>&token=<token>`. */
data class PairingLink(val url: String, val token: String) {
    companion object {
        fun parse(text: String): PairingLink? {
            val trimmed = text.trim()
            val prefix = "hexes://pair?"
            if (!trimmed.startsWith(prefix, ignoreCase = true)) return null
            val params = trimmed.substring(prefix.length).split('&').mapNotNull { part ->
                val i = part.indexOf('=')
                if (i <= 0) null else part.substring(0, i) to URLDecoder.decode(part.substring(i + 1), "UTF-8")
            }.toMap()
            val url = params["url"]?.takeIf { it.isNotBlank() } ?: return null
            val token = params["token"]?.takeIf { it.isNotBlank() } ?: return null
            return PairingLink(url, token)
        }
    }
}
