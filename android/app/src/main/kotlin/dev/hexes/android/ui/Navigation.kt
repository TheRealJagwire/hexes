package dev.hexes.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dev.hexes.android.container
import dev.hexes.android.ui.home.HomeScreen
import dev.hexes.android.ui.settings.SettingsScreen
import kotlinx.coroutines.flow.first

object Routes {
    const val Home = "home"
    const val Settings = "settings"
}

/** Starts on Home when a server is saved, otherwise on Settings to pair with one. */
@Composable
fun HexesNavHost() {
    val container = LocalContext.current.container
    val start by produceState<String?>(initialValue = null) {
        value = if (container.settings.connection.first() != null) Routes.Home else Routes.Settings
    }
    val startRoute = start
    if (startRoute == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    val nav = rememberNavController()
    val pending by container.pendingPairing.collectAsState()
    // A pairing link opened from outside always lands on the settings form.
    LaunchedEffect(pending) {
        if (pending != null) nav.navigate(Routes.Settings) { launchSingleTop = true }
    }

    NavHost(navController = nav, startDestination = startRoute) {
        composable(Routes.Home) {
            HomeScreen(onOpenSettings = { nav.navigate(Routes.Settings) })
        }
        composable(Routes.Settings) {
            SettingsScreen(
                canGoBack = nav.previousBackStackEntry != null,
                onBack = { nav.popBackStack() },
                onConnected = {
                    nav.navigate(Routes.Home) { popUpTo(0) { inclusive = true } }
                },
            )
        }
    }
}
