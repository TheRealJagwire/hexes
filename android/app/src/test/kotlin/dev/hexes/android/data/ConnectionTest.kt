package dev.hexes.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ConnectionTest {
    @Test
    fun addsSchemeAndTrimsSlash() {
        val c = Connection.parse("  mac.local:8000/ ", " tok ")
        assertEquals("http://mac.local:8000/", c?.baseUrl.toString())
        assertEquals("tok", c?.token)
    }

    @Test
    fun keepsHttps() {
        assertEquals("https://studio.example.com/", Connection.parse("https://studio.example.com", "")?.baseUrl.toString())
    }

    @Test
    fun rejectsBlankAndGarbage() {
        assertNull(Connection.parse("   ", ""))
        assertNull(Connection.parse("http://", ""))
    }

    @Test
    fun localhostWorksWithoutToken() {
        assertNotNull(Connection.parse("localhost:8000", ""))
    }
}
