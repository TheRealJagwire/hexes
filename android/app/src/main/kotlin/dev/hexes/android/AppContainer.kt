package dev.hexes.android

import android.app.Application
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import dev.hexes.android.data.ApiClient
import dev.hexes.android.data.ApiException
import dev.hexes.android.data.Connection
import dev.hexes.android.data.LiveUpdates
import dev.hexes.android.data.PairingLink
import dev.hexes.android.data.SettingsRepository
import dev.hexes.android.data.StatusTable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first

/** The few app-wide singletons. Small enough not to need a DI framework. */
class AppContainer(context: Context) {
    val settings = SettingsRepository(context.applicationContext)

    /** Follows the server's change stream while the app is on screen. */
    val live = LiveUpdates(settings.connection)

    /** A `hexes://pair` link received from outside the app, waiting to pre-fill the settings form. */
    val pendingPairing = MutableStateFlow<PairingLink?>(null)

    private var cached: Pair<Connection, ApiClient>? = null
    private var statusTable: Pair<ApiClient, StatusTable>? = null

    /** A client for the saved server; rebuilt when the address or token changes. */
    suspend fun api(): ApiClient {
        val connection = settings.connection.first() ?: throw ApiException.NotConfigured()
        cached?.let { (c, client) -> if (c == connection) return client }
        return ApiClient(connection).also { cached = connection to it }
    }

    /** The server's status table, fetched once per server; it only changes when Studio is upgraded. */
    suspend fun statuses(): StatusTable {
        val client = api()
        statusTable?.let { (c, table) -> if (c === client) return table }
        return client.statuses().also { statusTable = client to it }
    }
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

/** A ViewModel built from the container; `key` keeps one per screen argument (a hex id, say). */
@Composable
inline fun <reified VM : ViewModel> containerViewModel(
    key: String? = null,
    crossinline create: (AppContainer) -> VM,
): VM {
    val container = LocalContext.current.container
    return viewModel(key = key, factory = viewModelFactory { initializer { create(container) } })
}
