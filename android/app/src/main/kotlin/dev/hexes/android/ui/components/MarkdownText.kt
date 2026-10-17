package dev.hexes.android.ui.components

import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import dev.hexes.android.data.prepareMarkdown
import dev.hexes.android.ui.theme.Hexes

/** Opens only web and mail links from descriptions; anything else (intent:, file:, …) is ignored. */
private class SafeUriHandler(private val delegate: UriHandler) : UriHandler {
    override fun openUri(uri: String) {
        val scheme = runCatching { Uri.parse(uri).scheme?.lowercase() }.getOrNull()
        if (scheme in setOf("http", "https", "mailto")) delegate.openUri(uri)
    }
}

/** A hex description rendered as markdown, in the app's colours. Raw HTML is never rendered. */
@Composable
fun MarkdownText(text: String, modifier: Modifier = Modifier, body: TextStyle = MaterialTheme.typography.bodyLarge) {
    val c = Hexes.colors
    val handler = LocalUriHandler.current
    CompositionLocalProvider(LocalUriHandler provides SafeUriHandler(handler)) {
        Markdown(
            content = prepareMarkdown(text),
            colors = markdownColor(
                text = c.ink2,
                codeBackground = c.panel2,
                inlineCodeBackground = c.panel2,
                dividerColor = c.line,
                tableBackground = c.panel,
            ),
            typography = markdownTypography(
                text = body.copy(color = c.ink2),
                paragraph = body.copy(color = c.ink2),
                // Code needs an explicit colour, or it inherits one close to its background.
                inlineCode = body.copy(color = c.ink, fontFamily = FontFamily.Monospace),
                code = body.copy(color = c.ink, fontFamily = FontFamily.Monospace, fontSize = 14.sp),
                h1 = body.copy(color = c.ink, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
                h2 = body.copy(color = c.ink, fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold),
                h3 = body.copy(color = c.ink, fontSize = 17.sp, lineHeight = 23.sp, fontWeight = FontWeight.SemiBold),
                h4 = body.copy(color = c.ink, fontWeight = FontWeight.SemiBold),
                h5 = body.copy(color = c.ink, fontWeight = FontWeight.SemiBold),
                h6 = body.copy(color = c.ink, fontWeight = FontWeight.SemiBold),
                textLink = TextLinkStyles(style = SpanStyle(color = c.accent, textDecoration = TextDecoration.Underline)),
            ),
            modifier = modifier.fillMaxWidth(),
        )
    }
}

/**
 * Shows at most `maxHeight` of the markdown, fading out at the bottom, with a link to read the
 * rest when it was cut. `onReadMore` opens the hex's own page, where the full text lives.
 */
@Composable
fun ClampedMarkdown(
    text: String,
    maxHeight: Dp,
    onReadMore: () -> Unit,
    modifier: Modifier = Modifier,
    body: TextStyle = MaterialTheme.typography.bodyLarge,
) {
    var clamped by remember(text) { mutableStateOf(false) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(
            // Modifier order matters: the clip and fade must wrap the layout below, so they
            // apply to the cut-off size, not to the full-height content.
            Modifier
                .clipToBounds()
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .drawWithContent {
                    drawContent()
                    if (clamped) {
                        drawRect(
                            Brush.verticalGradient(0.7f to Color.Black, 1f to Color.Transparent),
                            blendMode = BlendMode.DstIn,
                        )
                    }
                }
                .layout { measurable, constraints ->
                    // Measure at full height to learn whether it overflows, then cut it off.
                    val placeable = measurable.measure(constraints.copy(maxHeight = Constraints.Infinity))
                    val limit = maxHeight.roundToPx()
                    val overflow = placeable.height > limit
                    if (overflow != clamped) clamped = overflow
                    layout(placeable.width, minOf(placeable.height, limit)) { placeable.place(0, 0) }
                },
        ) { MarkdownText(text, body = body) }
        if (clamped) {
            Text(
                "Read the full description",
                color = Hexes.colors.accent,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.tappable(onClick = onReadMore),
            )
        }
    }
}
