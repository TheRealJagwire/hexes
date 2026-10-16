package dev.hexes.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownPrepTest {
    @Test
    fun aLoneTagInCodeIsProtected() {
        assertEquals("Use `<​canvas>` here.", prepareMarkdown("Use `<canvas>` here."))
        assertEquals("`<\u200B/div>`", prepareMarkdown("`</div>`"))
        assertEquals("`<​img src=\"a\" />`", prepareMarkdown("`<img src=\"a\" />`"))
    }

    @Test
    fun otherTextIsLeftAlone() {
        val same = listOf(
            "Plain `grid` code",
            "Generic `Map<String, Int>` type",
            "a < b and c > d",
            "```html\n<div>x</div>\n```",
            "No code here",
            "",
        )
        same.forEach { assertEquals(it, prepareMarkdown(it)) }
    }
}
