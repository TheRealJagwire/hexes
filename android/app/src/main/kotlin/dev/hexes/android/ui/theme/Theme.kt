package dev.hexes.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import dev.hexes.android.data.ThemeChoice

/** The design tokens from Studio's app.css, in both palettes. */
data class HexesColors(
    val bg: Color,
    val backdrop: Color,
    val panel: Color,
    val panel2: Color,
    val lineSoft: Color,
    val line: Color,
    val lineStrong: Color,
    val ink: Color,
    val ink2: Color,
    val muted: Color,
    val accent: Color,
    val accentHover: Color,
    val onAccent: Color,
    val accentBg: Color,
    val ready: Color,
    val readyBg: Color,
    val verified: Color,
    val verifiedBg: Color,
    val blessed: Color,
    val blessedBg: Color,
    val blocked: Color,
    val blockedBg: Color,
    val success: Color,
    val dangerLine: Color,
    val danger: Color,
)

val DarkHexes = HexesColors(
    bg = Color(0xFF121418), backdrop = Color(0xFF0C0D10), panel = Color(0xFF1A1D22),
    panel2 = Color(0xFF20242A), lineSoft = Color(0xFF262A31), line = Color(0xFF2C313A),
    lineStrong = Color(0xFF3A404B), ink = Color(0xFFECEAE4), ink2 = Color(0xFFC9CDD3),
    muted = Color(0xFFA3A9B3), accent = Color(0xFFF2B13C), accentHover = Color(0xFFFFD07A),
    onAccent = Color(0xFF1A1405), accentBg = Color(0xFF362A12), ready = Color(0xFF8EC1FF),
    readyBg = Color(0xFF1C2A3D), verified = Color(0xFF6FD3C0), verifiedBg = Color(0xFF143330),
    blessed = Color(0xFFC9A7FF), blessedBg = Color(0xFF2A2140),
    blocked = Color(0xFFFF9A7A), blockedBg = Color(0xFF3A1F18), success = Color(0xFF6FD3A8),
    dangerLine = Color(0xFF5A2A24), danger = Color(0xFFB3261E),
)

val LightHexes = HexesColors(
    bg = Color(0xFFF6F5F2), backdrop = Color(0xFFE4E2DD), panel = Color(0xFFFFFFFF),
    panel2 = Color(0xFFF0EEEA), lineSoft = Color(0xFFECEAE5), line = Color(0xFFE0DDD7),
    lineStrong = Color(0xFFCFCBC4), ink = Color(0xFF1B1D21), ink2 = Color(0xFF3D424A),
    muted = Color(0xFF5F656E), accent = Color(0xFF96620A), accentHover = Color(0xFF7A4F06),
    onAccent = Color(0xFFFFFFFF), accentBg = Color(0xFFFBEFD6), ready = Color(0xFF1F5FB8),
    readyBg = Color(0xFFE3EEFC), verified = Color(0xFF0F7363), verifiedBg = Color(0xFFDDF3EE),
    blessed = Color(0xFF6B3FB8), blessedBg = Color(0xFFEFE7FB),
    blocked = Color(0xFFB23A17), blockedBg = Color(0xFFFBE5DD), success = Color(0xFF1E7A4F),
    dangerLine = Color(0xFFE8B4A8), danger = Color(0xFFB3261E),
)

val LocalHexesColors = staticCompositionLocalOf { DarkHexes }

/** Studio's palette for things Material has no slot for (status colours, kind badges). */
object Hexes {
    val colors: HexesColors
        @Composable get() = LocalHexesColors.current
}

@Composable
fun HexesTheme(choice: ThemeChoice = ThemeChoice.Dark, content: @Composable () -> Unit) {
    val dark = when (choice) {
        ThemeChoice.System -> isSystemInDarkTheme()
        ThemeChoice.Dark -> true
        ThemeChoice.Light -> false
    }
    val c = if (dark) DarkHexes else LightHexes
    val scheme = if (dark) {
        darkColorScheme(
            primary = c.accent, onPrimary = c.onAccent, background = c.bg, onBackground = c.ink,
            surface = c.panel, onSurface = c.ink, surfaceVariant = c.panel2,
            onSurfaceVariant = c.muted, outline = c.lineStrong, outlineVariant = c.line,
            error = c.blocked, onError = c.onAccent, secondaryContainer = c.accentBg,
            onSecondaryContainer = c.accent,
        )
    } else {
        lightColorScheme(
            primary = c.accent, onPrimary = c.onAccent, background = c.bg, onBackground = c.ink,
            surface = c.panel, onSurface = c.ink, surfaceVariant = c.panel2,
            onSurfaceVariant = c.muted, outline = c.lineStrong, outlineVariant = c.line,
            error = c.blocked, onError = c.onAccent, secondaryContainer = c.accentBg,
            onSecondaryContainer = c.accent,
        )
    }
    CompositionLocalProvider(LocalHexesColors provides c) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
