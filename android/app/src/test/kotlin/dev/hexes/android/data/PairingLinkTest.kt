package dev.hexes.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingLinkTest {
    @Test
    fun parsesTheLinkStudioPrints() {
        val link = PairingLink.parse(
            "hexes://pair?url=http%3A%2F%2Fmac.tail1234.ts.net%3A8000&token=abc%2Bdef%3D",
        )
        assertEquals(PairingLink("http://mac.tail1234.ts.net:8000", "abc+def="), link)
    }

    @Test
    fun ignoresSurroundingWhitespaceAndCase() {
        val link = PairingLink.parse("  HEXES://pair?url=http%3A%2F%2Fh%3A1&token=t  ")
        assertEquals("http://h:1", link?.url)
    }

    @Test
    fun rejectsAnythingElse() {
        assertNull(PairingLink.parse("http://mac:8000"))
        assertNull(PairingLink.parse("hexes://pair?url=http%3A%2F%2Fh"))
        assertNull(PairingLink.parse("hexes://pair?token=t"))
        assertNull(PairingLink.parse(""))
    }
}
