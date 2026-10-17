package dev.hexes.android.ui.settings

import dev.hexes.android.ui.components.readable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import dev.hexes.android.container
import dev.hexes.android.data.ThemeChoice
import dev.hexes.android.ui.theme.Hexes

@Composable
fun SettingsScreen(canGoBack: Boolean, onBack: () -> Unit, onConnected: () -> Unit) {
    val container = LocalContext.current.container
    val vm: SettingsViewModel = viewModel(
        factory = viewModelFactory { initializer { SettingsViewModel(container) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = Hexes.colors

    LaunchedEffect(state.connect) {
        if (state.connect is ConnectState.Connected) onConnected()
    }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier
                .readable()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (canGoBack) TextButton(onClick = onBack) { Text("‹ Back") }
            Text("Connect to Studio", style = MaterialTheme.typography.headlineMedium)
            Text(
                "Hexes shows the project on your computer. Run Studio there, then enter its address" +
                    " and token, or paste the hexes://pair link it prints.",
                color = colors.ink2,
            )

            OutlinedTextField(
                value = state.url,
                onValueChange = vm::onUrlChange,
                label = { Text("Studio address") },
                placeholder = { Text("localhost:8000") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = state.token,
                onValueChange = vm::onTokenChange,
                label = { Text("Token") },
                supportingText = { Text("Not needed for localhost or adb reverse.") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )

            Button(
                onClick = vm::connect,
                enabled = state.connect !is ConnectState.Connecting,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (state.connect is ConnectState.Connecting) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = colors.onAccent)
                } else {
                    Text("Connect")
                }
            }
            when (val c = state.connect) {
                is ConnectState.Failed -> Text(c.message, color = MaterialTheme.colorScheme.error)
                is ConnectState.Connected -> Text(c.summary, color = colors.success)
                else -> {}
            }

            Text("Appearance", style = MaterialTheme.typography.titleMedium)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                ThemeChoice.entries.forEachIndexed { index, choice ->
                    SegmentedButton(
                        selected = state.theme == choice,
                        onClick = { vm.onThemeChange(choice) },
                        shape = SegmentedButtonDefaults.itemShape(index, ThemeChoice.entries.size),
                    ) { Text(choice.name) }
                }
            }

            Text(
                "Emulator or USB phone: run `adb reverse tcp:8000 tcp:8000` on your computer," +
                    " then use localhost:8000.",
                color = colors.muted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
