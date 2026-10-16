package dev.hexes.android.data

private val loneTagSpan = Regex("`([^`\\n]*)`")
private val loneTag = Regex("^</?[A-Za-z][^<>]*/?>$")

/**
 * The markdown renderer treats an inline code span that is exactly one HTML tag (`<canvas>`) as
 * HTML and shows nothing. A zero-width space after the `<` stops that and looks identical.
 */
fun prepareMarkdown(text: String): String =
    loneTagSpan.replace(text) { m ->
        val inner = m.groupValues[1]
        if (loneTag.matches(inner.trim())) "`" + inner.replaceFirst("<", "<​") + "`" else m.value
    }
