package dev.hexes.android

import android.app.Application
import android.content.Context
import dev.hexes.android.data.PairingLink
import dev.hexes.android.data.SettingsRepository
import kotlinx.coroutines.flow.MutableStateFlow

/** The few app-wide singletons. Small enough not to need a DI framework. */
class AppContainer(context: Context) {
    val settings = SettingsRepository(context.applicationContext)

    /** A `hexes://pair` link received from outside the app, waiting to pre-fill the settings form. */
    val pendingPairing = MutableStateFlow<PairingLink?>(null)
}

class HexesApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

val Context.container: AppContainer
    get() = (applicationContext as HexesApp).container
