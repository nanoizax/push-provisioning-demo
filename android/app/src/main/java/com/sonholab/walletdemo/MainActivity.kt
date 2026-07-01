package com.sonholab.walletdemo

import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import com.sonholab.pushprovisioning.AddToGoogleWalletButton
import com.sonholab.pushprovisioning.GoogleProvisioningRequest
import com.sonholab.pushprovisioning.IssuerApiClient
import com.sonholab.pushprovisioning.IssuerApiService
import com.sonholab.pushprovisioning.EligibilityRequest
import com.sonholab.pushprovisioning.ProvisioningResult
import com.sonholab.pushprovisioning.PushProvisioningManager
import kotlinx.coroutines.launch

/**
 * Demo issuer Activity.
 *
 * Flow on screen:
 *   1. On start: fetch the stableHardwareId, ask the issuer for eligibility, and
 *      ask Google whether the card is already tokenized. From those we decide
 *      whether to show/enable the "Add to Google Wallet" button.
 *   2. On button tap: fetch the OPC from the issuer, decode base64, and call
 *      pushTokenize — which launches Google Pay's provisioning UI.
 *   3. onActivityResult: translate the result and update the UI.
 *
 * Everything TapAndPay-related is delegated to [PushProvisioningManager]; this
 * Activity only owns UI state and the orchestration between issuer + Google.
 */
class MainActivity : ComponentActivity() {

    // Fake card identifier for the demo — matches the issuer's mock data.
    private val cardId = "card_demo_visa_4242"

    private lateinit var manager: PushProvisioningManager
    private lateinit var issuerApi: IssuerApiService

    // Single in-flight job per concern, so overlapping DataChanged callbacks and
    // user taps cancel-and-replace the previous work instead of racing on uiState.
    private var refreshJob: Job? = null
    private var provisioningJob: Job? = null

    // --- Compose UI state -----------------------------------------------------
    private var uiState by mutableStateOf(DemoUiState())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        manager = PushProvisioningManager(this)
        // Default base url is http://10.0.2.2:8787 (emulator -> host localhost).
        issuerApi = IssuerApiClient.create()

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFFF3F4F6),
                ) {
                    DemoScreen(
                        state = uiState,
                        onAddToWallet = ::onAddToWalletClicked,
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()

        // Refresh eligibility whenever tokens change (e.g. user removes the card
        // from Google Wallet -> button should re-enable). Registered only while
        // the Activity is visible so callbacks don't arrive in the background.
        manager.registerDataChangedListener {
            triggerRefresh()
        }

        // Kick off the initial eligibility + isTokenized checks.
        triggerRefresh()
    }

    override fun onStop() {
        manager.unregisterDataChangedListener()
        super.onStop()
    }

    /**
     * Launches [refreshState] as the single refresh job, cancelling any previous
     * one first so overlapping DataChanged callbacks don't race on [uiState].
     */
    private fun triggerRefresh() {
        refreshJob?.cancel()
        refreshJob = lifecycleScope.launch { refreshState() }
    }

    /**
     * Resolves device ids, checks issuer eligibility and Google tokenization
     * state, then updates [uiState] so the button reflects reality.
     */
    private suspend fun refreshState() {
        uiState = uiState.copy(loading = true, message = "Checking eligibility…")
        try {
            // 1) TapAndPay device id required for eligibility + OPC.
            val hardwareId = manager.getStableHardwareId()

            // 2) Ask the issuer if this card can be pushed to Google on this device.
            val eligibility = issuerApi.checkEligibility(
                cardId = cardId,
                body = EligibilityRequest(walletPlatform = "google", deviceId = hardwareId),
            )

            if (!eligibility.eligible) {
                uiState = uiState.copy(
                    loading = false,
                    canAdd = false,
                    alreadyAdded = false,
                    displayName = eligibility.displayName ?: uiState.displayName,
                    last4 = eligibility.last4 ?: uiState.last4,
                    cardholderName = eligibility.cardholderName ?: uiState.cardholderName,
                    message = eligibility.reason ?: "Card not eligible for Google Wallet.",
                )
                return
            }

            // 3) Map the issuer network string and check Google for an existing token.
            val network = PushProvisioningManager.networkFromString(eligibility.network ?: "visa")
            val tsp = tspFromNetworkString(eligibility.network ?: "visa")
            val last4 = eligibility.last4 ?: "4242"

            val alreadyTokenized = manager.isCardTokenized(
                lastDigits = last4,
                network = network,
                tokenServiceProvider = tsp,
            )

            uiState = uiState.copy(
                loading = false,
                displayName = eligibility.displayName ?: uiState.displayName,
                cardholderName = eligibility.cardholderName ?: uiState.cardholderName,
                last4 = last4,
                network = eligibility.network ?: "visa",
                // Show the button as enabled only when eligible AND not already added.
                canAdd = !alreadyTokenized,
                alreadyAdded = alreadyTokenized,
                message = if (alreadyTokenized) {
                    "Already in Google Wallet."
                } else {
                    "Ready to add to Google Wallet."
                },
            )
        } catch (t: Throwable) {
            // TapAndPay throws ApiException until the app is allowlisted; the
            // issuer may be unreachable in a pure-UI demo. Surface it honestly.
            Log.e("WalletDemo", "refreshState failed", t)
            uiState = uiState.copy(
                loading = false,
                canAdd = false,
                message = "Setup incomplete: ${t.message ?: t.javaClass.simpleName}. " +
                    "TapAndPay requires Google allowlisting and a running issuer backend.",
            )
        }
    }

    /**
     * Button handler: request the OPC from the issuer, then hand it to Google Pay
     * via pushTokenize. The result comes back in [onActivityResult].
     */
    private fun onAddToWalletClicked() {
        // Cancel-and-replace so a double tap can't launch two provisioning flows.
        provisioningJob?.cancel()
        provisioningJob = lifecycleScope.launch {
            uiState = uiState.copy(loading = true, message = "Requesting secure card data…")
            try {
                // Device ids required to scope the OPC.
                val hardwareId = manager.getStableHardwareId()
                val walletId = manager.getActiveWalletId()

                // Issuer -> TSP mints the OPC (encrypted; app never sees the PAN).
                val opcResponse = issuerApi.requestGoogleOpc(
                    GoogleProvisioningRequest(
                        cardId = cardId,
                        deviceId = hardwareId,
                        walletAccountId = walletId,
                    )
                )

                // Decode the base64 OPC into raw bytes for setOpaquePaymentCard.
                val opcBytes = Base64.decode(opcResponse.opc, Base64.DEFAULT)

                // Map the issuer's string network/TSP to TapAndPay int constants.
                val network = PushProvisioningManager.networkFromString(opcResponse.network)
                val tsp = PushProvisioningManager.tokenProviderFromString(
                    opcResponse.tokenServiceProvider
                )

                uiState = uiState.copy(loading = false, message = "Opening Google Pay…")

                // Launches Google Pay's provisioning UI; result -> onActivityResult.
                manager.pushTokenize(
                    activity = this@MainActivity,
                    opc = opcBytes,
                    network = network,
                    tsp = tsp,
                    displayName = opcResponse.displayName,
                    lastDigits = opcResponse.lastDigits,
                    // No prefilled address in the demo; Google will collect it if needed.
                    userAddress = null,
                )
            } catch (t: Throwable) {
                Log.e("WalletDemo", "onAddToWalletClicked failed", t)
                uiState = uiState.copy(
                    loading = false,
                    message = "Could not start provisioning: ${t.message ?: t.javaClass.simpleName}",
                )
            }
        }
    }

    /**
     * Handles the Google Pay provisioning result.
     *
     * NOTE: onActivityResult is deprecated in favor of the Activity Result APIs,
     * but TapAndPay.pushTokenize uses the classic startActivityForResult contract
     * (it calls it internally with the request code we pass), so this override is
     * the correct integration point.
     */
    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        // Delegate to the library; returns null if it's not our request code.
        val result = manager.handleActivityResult(requestCode, resultCode, data)
        if (result == null) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }

        when (result) {
            is ProvisioningResult.Success -> {
                // Don't hard-set an "added" flag: re-query the authoritative token
                // state (isCardTokenized) so the UI reflects the real PENDING/ACTIVE
                // status rather than assuming the token is already usable.
                uiState = uiState.copy(
                    message = "Added to Google Wallet" +
                        (result.issuerTokenId?.let { " (token $it)" } ?: "") +
                        ". Refreshing status…",
                )
                triggerRefresh()
            }

            is ProvisioningResult.Cancelled -> {
                uiState = uiState.copy(message = "Provisioning cancelled.")
            }

            is ProvisioningResult.Failed -> {
                uiState = uiState.copy(message = "Provisioning failed: ${result.reason}")
            }
        }
    }

    /**
     * The demo issuer's eligibility payload uses a short "visa"/"mastercard"
     * string; derive the matching TOKEN_PROVIDER_* from it. (The OPC response
     * carries the explicit TSP string, so this helper is only used pre-OPC.)
     */
    private fun tspFromNetworkString(network: String): Int =
        PushProvisioningManager.tokenProviderFromString(network)
}

/** Immutable UI state for the demo screen. */
data class DemoUiState(
    val loading: Boolean = false,
    val canAdd: Boolean = false,
    val alreadyAdded: Boolean = false,
    val displayName: String = "SonhoLab Debit",
    val cardholderName: String = "Leandro Perez",
    val last4: String = "4242",
    val network: String = "visa",
    val message: String = "Starting…",
)

// ---------------------------------------------------------------------------
// Compose UI
// ---------------------------------------------------------------------------

@Composable
private fun DemoScreen(
    state: DemoUiState,
    onAddToWallet: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Top,
    ) {
        Spacer(Modifier.height(24.dp))

        Text(
            text = "SonhoLab Wallet",
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF111827),
        )

        Spacer(Modifier.height(24.dp))

        DemoCard(
            displayName = state.displayName,
            cardholderName = state.cardholderName,
            last4 = state.last4,
            network = state.network,
        )

        Spacer(Modifier.height(28.dp))

        if (state.loading) {
            CircularProgressIndicator()
        } else {
            // The button is shown at all times for demo clarity, but only enabled
            // when the card is eligible and not already provisioned.
            AddToGoogleWalletButton(
                enabled = state.canAdd,
                onClick = onAddToWallet,
            )
        }

        Spacer(Modifier.height(16.dp))

        Text(
            text = state.message,
            fontSize = 13.sp,
            color = Color(0xFF4B5563),
        )
    }
}

/** A simple faux payment-card tile so the demo has something to "add". */
@Composable
private fun DemoCard(
    displayName: String,
    cardholderName: String,
    last4: String,
    network: String,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(190.dp)
            .background(
                brush = Brush.linearGradient(
                    colors = listOf(Color(0xFF1E3A8A), Color(0xFF2563EB)),
                ),
                shape = RoundedCornerShape(18.dp),
            )
            .padding(20.dp),
    ) {
        Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Text(
                text = displayName,
                color = Color.White,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "•••• •••• •••• $last4",
                color = Color.White,
                fontSize = 20.sp,
                fontWeight = FontWeight.Medium,
            )
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = cardholderName.uppercase(),
                    color = Color.White,
                    fontSize = 13.sp,
                )
                Text(
                    text = network.uppercase(),
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
