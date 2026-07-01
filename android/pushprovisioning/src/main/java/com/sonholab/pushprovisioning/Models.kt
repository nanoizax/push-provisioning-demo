package com.sonholab.pushprovisioning

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Data models that mirror the issuer backend HTTP contract exactly, plus a small
 * sealed result type for the TapAndPay push-tokenization flow.
 *
 * All request/response classes are annotated with [JsonClass] `generateAdapter = true`
 * so Moshi generates the (de)serialization adapters at compile time (no reflection).
 *
 * ---------------------------------------------------------------------------
 * ISSUER CONTRACT
 * ---------------------------------------------------------------------------
 * Base URL (emulator -> host localhost): http://10.0.2.2:8787
 * Headers: Authorization: Bearer demo-session-token, Content-Type: application/json
 */

// ---------------------------------------------------------------------------
// POST /v1/cards/{cardId}/eligibility
// ---------------------------------------------------------------------------

/**
 * Body sent to the eligibility endpoint.
 *
 * @param walletPlatform always "google" for this demo (the issuer may also serve
 *        an "apple" flow from the same backend).
 * @param deviceId the TapAndPay *stable hardware id* obtained from
 *        [PushProvisioningManager.getStableHardwareId]. The issuer uses it to
 *        de-duplicate provisioning across devices and to satisfy network rules.
 */
@JsonClass(generateAdapter = true)
data class EligibilityRequest(
    val walletPlatform: String = "google",
    val deviceId: String,
)

/**
 * Eligibility answer from the issuer.
 *
 * @param eligible whether this card may be pushed to Google Wallet on this device.
 * @param network "visa" or "mastercard" (lowercase string in the contract; the
 *        manager maps it to TapAndPay's CARD_NETWORK_* int constants).
 * @param cardholderName display name of the cardholder, e.g. "Leandro Perez".
 * @param last4 last four PAN digits, e.g. "4242".
 * @param displayName the label shown in Google Wallet, e.g. "SonhoLab Debit".
 * @param reason human-readable rejection reason; null when [eligible] is true.
 */
@JsonClass(generateAdapter = true)
data class EligibilityResponse(
    val eligible: Boolean,
    val network: String?,
    val cardholderName: String?,
    val last4: String?,
    val displayName: String?,
    val reason: String?,
)

// ---------------------------------------------------------------------------
// POST /v1/provisioning/google/opc
// ---------------------------------------------------------------------------

/**
 * Body sent to request an Opaque Payment Card (OPC).
 *
 * The issuer forwards these identifiers to the Token Service Provider (Visa VDEP /
 * Mastercard MDES), which mints the OPC bound to this specific device + wallet.
 *
 * @param cardId the issuer's card identifier, e.g. "card_demo_visa_4242".
 * @param deviceId the stable hardware id (same value used for eligibility).
 * @param walletAccountId the *active wallet id* from
 *        [PushProvisioningManager.getActiveWalletId]; scopes the OPC to the
 *        Google Wallet account currently active on the device.
 */
@JsonClass(generateAdapter = true)
data class GoogleProvisioningRequest(
    val cardId: String,
    val deviceId: String,
    val walletAccountId: String,
)

/**
 * OPC response from the issuer.
 *
 * @param opc base64-encoded Opaque Payment Card. Decode to a [ByteArray] before
 *        passing it to `PushTokenizeRequest.Builder().setOpaquePaymentCard(...)`.
 *        The app NEVER sees the clear PAN — the OPC is an encrypted blob.
 * @param tokenServiceProvider the string "TOKEN_PROVIDER_VISA" or
 *        "TOKEN_PROVIDER_MASTERCARD"; mapped to TapAndPay.TOKEN_PROVIDER_* ints.
 * @param displayName label for the wallet tile, e.g. "SonhoLab Debit".
 * @param lastDigits last digits shown on the tile, e.g. "4242".
 * @param network the string "NETWORK_VISA" or "NETWORK_MASTERCARD"; mapped to
 *        TapAndPay.CARD_NETWORK_* ints.
 * @param reference issuer-side provisioning reference for audit/tracing.
 */
@JsonClass(generateAdapter = true)
data class GoogleOpcResponse(
    val opc: String,
    val tokenServiceProvider: String,
    val displayName: String,
    val lastDigits: String,
    val network: String,
    @Json(name = "reference") val reference: String?,
)

// ---------------------------------------------------------------------------
// Result of the on-device push-tokenization flow.
// ---------------------------------------------------------------------------

/**
 * Outcome of `TapAndPayClient.pushTokenize(...)` after the Google Pay UI returns
 * through `onActivityResult`. This is a caller-friendly wrapper over the raw
 * Activity result codes.
 */
sealed interface ProvisioningResult {

    /**
     * The token was created (or is being created) in Google Wallet.
     *
     * @param issuerTokenId the token id echoed back by Google
     *        (`TapAndPay.EXTRA_ISSUER_TOKEN_ID`). May be null on some OEMs even on
     *        success; treat presence as best-effort telemetry, not a hard gate.
     */
    data class Success(val issuerTokenId: String?) : ProvisioningResult

    /** The user backed out of the Google Pay provisioning UI. */
    data object Cancelled : ProvisioningResult

    /**
     * Google Pay reported a failure (`TapAndPay.RESULT_FAILED`) or an unexpected
     * result code was returned.
     *
     * @param reason short diagnostic string for logs / UI.
     */
    data class Failed(val reason: String) : ProvisioningResult
}
