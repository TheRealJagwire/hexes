package dev.hexes.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.hexes.android.container
import dev.hexes.android.data.LiveStatus
import dev.hexes.android.ui.hex.HexScreen
import dev.hexes.android.ui.project.ProjectScreen
import dev.hexes.android.ui.projects.ProjectsScreen
import dev.hexes.android.ui.settings.SettingsScreen
import dev.hexes.android.ui.theme.Hexes
import dev.hexes.android.ui.welcome.WelcomeScreen
import kotlinx.coroutines.flow.first
import androidx.compose.runtime.produceState
import androidx.compose.material3.CircularProgressIndicator
import androidx.navigation.NavHostController

object Routes {
    const val Start = "start"
    const val Settings = "settings"
    const val Welcome = "welcome"
    const val Projects = "projects"
    const val ProjectPattern = "project/{id}"
    const val HexPattern = "hex/{id}"
    fun project(id: String) = "project/$id"
    fun hex(id: String) = "hex/$id"
}

/** Starts on Start (which routes by server state) when a server is saved, else on Settings. */
@Composable
fun HexesNavHost() {
    val container = LocalContext.current.container
    val first by produceState<String?>(initialValue = null) {
        // A pairing link that opened the app goes straight to the form that applies it.
        val paired = container.pendingPairing.value != null
        value = if (!paired && container.settings.connection.first() != null) Routes.Start else Routes.Settings
    }
    val startRoute = first
    if (startRoute == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    val nav = rememberNavController()
    val pending by container.pendingPairing.collectAsState()
    // A pairing link opened from outside always lands on the settings form.
    LaunchedEffect(pending) {
        // Only when already running: at launch the start route is already the settings form.
        val here = nav.currentDestination?.route
        if (pending != null && here != null && here != Routes.Settings) {
            nav.navigate(Routes.Settings) { launchSingleTop = true }
        }
    }

    Box(Modifier.fillMaxSize()) {
        NavHost(navController = nav, startDestination = startRoute) {
            composable(Routes.Start) {
                StartScreen(
                    onGo = { route -> nav.navigate(route) { popUpTo(Routes.Start) { inclusive = true } } },
                    onSettings = { nav.navigate(Routes.Settings) },
                )
            }
            composable(Routes.Welcome) {
                WelcomeScreen(
                    onBack = if (nav.previousBackStackEntry != null) ({ nav.popBackStack() }) else null,
                    onOpened = { nav.goHome() },
                )
            }
            composable(Routes.Projects) {
                ProjectsScreen(
                    onOpenProject = { nav.navigate(Routes.project(it)) },
                    onSettings = { nav.navigate(Routes.Settings) },
                    onSwitchFolder = { nav.navigate(Routes.Welcome) },
                )
            }
            composable(Routes.ProjectPattern, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                val id = it.arguments?.getString("id").orEmpty()
                ProjectScreen(
                    id = id,
                    onBack = { nav.navigate(Routes.Projects) { popUpTo(Routes.Projects) { inclusive = true } } },
                    onOpenHex = { hexId -> nav.navigate(Routes.hex(hexId)) },
                    onSettings = { nav.navigate(Routes.Settings) },
                )
            }
            composable(Routes.HexPattern, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                val id = it.arguments?.getString("id").orEmpty()
                HexScreen(
                    id = id,
                    onBack = { nav.popBackStack() },
                    onOpenHex = { hexId -> nav.navigate(Routes.hex(hexId)) },
                    onOpenProject = { projectId -> nav.navigate(Routes.project(projectId)) },
                )
            }
            composable(Routes.Settings) {
                SettingsScreen(
                    canGoBack = nav.previousBackStackEntry != null,
                    onBack = { nav.popBackStack() },
                    onConnected = { nav.goHome() },
                )
            }
        }
        LiveDot(Modifier.align(Alignment.BottomEnd))
    }
}

/** Back to the start of the app, which then routes by what the server has open. */
private fun NavHostController.goHome() {
    navigate(Routes.Start) { popUpTo(0) { inclusive = true } }
}

/** A dot in the corner like the web's: green while live, pulsing amber while reconnecting. */
@Composable
private fun LiveDot(modifier: Modifier = Modifier) {
    val container = LocalContext.current.container
    val status by container.live.status.collectAsState()
    if (status == LiveStatus.Idle || status == LiveStatus.Connecting) return
    val c = Hexes.colors
    val live = status == LiveStatus.Live
    val pulse = rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 1f, targetValue = 0.3f, label = "alpha",
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
    )
    Box(
        modifier
            .navigationBarsPadding()
            .padding(12.dp)
            .size(10.dp)
            .alpha(if (live) 1f else pulse.value)
            .clip(CircleShape)
            .background(if (live) c.success else c.blocked)
            .semantics { contentDescription = if (live) "Live" else "Reconnecting" },
    )
}
