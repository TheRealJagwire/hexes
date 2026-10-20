package dev.hexes.android.ui.components

import android.content.ClipData
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.hexes.android.data.Progress
import dev.hexes.android.data.Status
import dev.hexes.android.ui.theme.Hexes
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

val Mono = FontFamily.Monospace

/** Text and background colours of a status, as on the web's status pill. */
@Composable
fun statusColors(status: Status): Pair<Color, Color> {
    val c = Hexes.colors
    return when (status) {
        Status.Ready -> c.ready to c.readyBg
        Status.InProgress -> c.accent to c.accentBg
        Status.Verified -> c.verified to c.verifiedBg
        Status.Blocked -> c.blocked to c.blockedBg
        Status.Blessed -> c.blessed to c.blessedBg
        Status.PullRequested -> c.accent to c.accentBg
        Status.Merged -> c.verified to c.verifiedBg
        Status.Done, Status.Answered, Status.Closed, Status.Unknown -> c.muted to c.lineSoft
    }
}

@Composable
fun StatusPill(status: Status, modifier: Modifier = Modifier) {
    val (fg, bg) = statusColors(status)
    Text(
        status.wire,
        color = fg,
        fontFamily = Mono,
        fontSize = 12.sp,
        modifier = modifier.clip(CircleShape).background(bg).padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

@Composable
fun KindBadge(kind: String, modifier: Modifier = Modifier) {
    val c = Hexes.colors
    Text(
        kind,
        color = c.accent,
        fontFamily = Mono,
        fontSize = 12.sp,
        modifier = modifier.clip(CircleShape).background(c.accentBg).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/** A bordered panel like the web's `.card`. */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    strong: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val c = Hexes.colors
    val shape = RoundedCornerShape(14.dp)
    val base = modifier
        .clip(shape)
        .background(c.panel)
        .border(BorderStroke(1.dp, if (strong) c.lineStrong else c.line), shape)
    Box(if (onClick != null) base.clickable(role = Role.Button, onClick = onClick) else base) { content() }
}

@Composable
fun CopyButton(text: String, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    val c = Hexes.colors
    Box(
        modifier
            .size(48.dp)
            .clip(CircleShape)
            .semantics { contentDescription = if (copied) "Copied" else "Copy hex id" }
            .clickable(role = Role.Button) {
                scope.launch {
                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("hex id", text)))
                    copied = true
                    delay(1500)
                    copied = false
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(36.dp).border(BorderStroke(1.dp, c.lineStrong), RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center,
        ) { Text(if (copied) "✓" else "⧉", color = c.muted, fontSize = 16.sp) }
    }
}

/** The hexagon with a project's initials, as on the projects list. */
@Composable
fun HexIcon(initial: String, size: Dp = 44.dp) {
    val c = Hexes.colors
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val w = this.size.width
            val h = this.size.height
            val path = Path().apply {
                moveTo(w * 0.5f, h * 0.07f)
                lineTo(w * 0.87f, h * 0.285f)
                lineTo(w * 0.87f, h * 0.715f)
                lineTo(w * 0.5f, h * 0.93f)
                lineTo(w * 0.13f, h * 0.715f)
                lineTo(w * 0.13f, h * 0.285f)
                close()
            }
            drawPath(path, c.panel2)
            drawPath(path, c.lineStrong, style = Stroke(width = 1.5.dp.toPx(), join = StrokeJoin.Round))
        }
        Text(initial, color = c.accent, fontFamily = Mono, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun ProgressRing(progress: Progress, modifier: Modifier = Modifier) {
    val c = Hexes.colors
    val color = if (progress.pct == 100) c.success else c.accent
    val description = "${progress.pct} percent, ${progress.done} of ${progress.total} stories done"
    Canvas(modifier.size(48.dp).semantics { contentDescription = description }) {
        val stroke = 5.dp.toPx()
        val inset = stroke / 2
        val arcSize = Size(size.width - stroke, size.height - stroke)
        drawArc(c.line, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
        if (progress.total > 0) {
            drawArc(
                color, -90f, 360f * progress.done / progress.total, false, Offset(inset, inset), arcSize,
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
    }
}

@Composable
fun LoadingState(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading" })
    }
}

@Composable
fun ErrorState(
    message: String,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
    missing: Boolean = false,
    extra: @Composable () -> Unit = {},
) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Gone for good (deleted elsewhere): retrying cannot help, so say so and offer a way out.
        if (missing) Text("This is gone", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 8.dp))
        Text(
            message,
            color = if (missing) Hexes.colors.muted else MaterialTheme.colorScheme.error,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (onRetry != null && !missing) Button(onClick = onRetry) { Text("Retry") }
            extra()
        }
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick) { Text(text) }
}

/** A row with a back arrow, a title and optional trailing actions. */
@Composable
fun TopBar(
    title: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    actions: @Composable () -> Unit = {},
) {
    Row(
        modifier.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (onBack != null) {
            Box(
                Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onBack)
                    .semantics { contentDescription = "Back" },
                contentAlignment = Alignment.Center,
            ) { Text("‹", fontSize = 28.sp, color = Hexes.colors.ink2) }
        }
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            maxLines = 1,
            modifier = Modifier.weight(1f).padding(start = if (onBack == null) 4.dp else 0.dp),
        )
        actions()
    }
}

/** The full-height content column, capped at a readable width and centred on tablets and in landscape. */
fun Modifier.readable(): Modifier = fillMaxSize()
    .safeDrawingPadding()
    .wrapContentWidth(Alignment.CenterHorizontally)
    .widthIn(max = 720.dp)
    .fillMaxWidth()

/** A touch target of at least 48dp that TalkBack announces as a button. */
fun Modifier.tappable(label: String? = null, enabled: Boolean = true, onClick: () -> Unit): Modifier =
    heightIn(min = 48.dp).clickable(enabled = enabled, onClickLabel = label, role = Role.Button, onClick = onClick)

/** A row that expands and collapses, announced with its state. */
fun Modifier.toggleRow(open: Boolean, onToggle: () -> Unit): Modifier =
    semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
        .tappable(if (open) "Collapse" else "Expand", onClick = onToggle)
