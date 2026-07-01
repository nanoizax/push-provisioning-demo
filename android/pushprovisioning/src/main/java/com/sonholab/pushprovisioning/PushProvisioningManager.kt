package com.sonholab.pushprovisioning

import android.app.Activity
import android.content.Intent
import android.util.Log
import com.google.android.gms.tapandpay.TapAndPay
import com.google.android.gms.tapandpay.TapAndPayClient
import com.google.android.gms.tapandpay.issuer.IsTokenizedRequest
import com.google.android.gms.tapandpay.issuer.PushTokenizeRequest
import com.google.android.gms.tapandpay.issuer.UserAddress
import com.google.android.gms.tasks.Task
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Thin, coroutine-friendly wrapper over Google's [TapAndPayClient] (Google Pay
 * Push Provisioning).
 *
 * Responsibilities:
 *  - Resolve the device identifiers Google requires (stable hardware id, active
 *    wallet id) before an OPC can be minted.
 *  - Ask Google whether a given card is already tokenized on this device (so the
 *    UI can hide the "Add to Google Wallet" button and avoid duplicates).
 *  - Kick off the on-device push-tokenization UI via [pushTokenize].
 *  - Translate the Activity result back into a [ProvisioningResult].
 *  - Subscribe to token lifecycle changes via a DataChangedListener.
 *
 * IMPORTANT — allowlist: every TapAndPay call below will return an ApiException
 * with a TAP_AND_PAY_* status code until your app's package name and signing
 * SHA-256 are allowlisted by Google as an approved issuer. See README.
 *
 * @param activity used both as the TapAndPay client host and as the Activity that
 *        `pushTokenize` launches its UI from (results arrive in its onActivityResult).
 */
class PushProvisioningManager(private val activity: Activity) {

    // TapAndPay.getClient(activity) returns a TapAndPayClient bound to this
    // Activity/Context. Reused for the manager's lifetime.
    private val client: TapAndPayClient = TapAndPay.getClient(activity)

    // Held so we can unregister on teardown.
    private var dataChangedListener: TapAndPay.DataChangedListener? = null

    companion object {
        private const val TAG = "PushProvisioning"

        /**
         * Arbitrary request code passed to `pushTokenize`; the same value must be
         * matched in `onActivityResult` / [handleActivityResult].
         */
        const val REQUEST_CODE_PUSH_TOKENIZE = 3001

        /**
         * Maps the issuer's network string to a TapAndPay CARD_NETWORK_* int.
         * Accepts both the eligibility form ("visa"/"mastercard") and the OPC
         * form ("NETWORK_VISA"/"NETWORK_MASTERCARD").
         */
        fun networkFromString(raw: String): Int = when (raw.trim().uppercase()) {
            "VISA", "NETWORK_VISA" -> TapAndPay.CARD_NETWORK_VISA
            "MASTERCARD", "NETWORK_MASTERCARD" -> TapAndPay.CARD_NETWORK_MASTERCARD
            else -> error("Unsupported card network: $raw")
        }

        /**
         * Maps the issuer's TSP string to a TapAndPay TOKEN_PROVIDER_* int.
         * Accepts "TOKEN_PROVIDER_VISA" / "TOKEN_PROVIDER_MASTERCARD" and the
         * short "visa"/"mastercard" forms.
         */
        fun tokenProviderFromString(raw: String): Int = when (raw.trim().uppercase()) {
            "TOKEN_PROVIDER_VISA", "VISA" -> TapAndPay.TOKEN_PROVIDER_VISA
            "TOKEN_PROVIDER_MASTERCARD", "MASTERCARD" -> TapAndPay.TOKEN_PROVIDER_MASTERCARD
            else -> error("Unsupported token service provider: $raw")
        }
    }

    // -----------------------------------------------------------------------
    // Device identifiers
    // -----------------------------------------------------------------------

    /**
     * The device's *stable hardware id* — a Google-scoped identifier that stays
     * constant across app reinstalls on the same device. The issuer/TSP binds the
     * OPC to this id, so it must be sent both to `eligibility` and to `opc`.
     */
    suspend fun getStableHardwareId(): String =
        client.stableHardwareId.awaitTask()

    /**
     * The id of the Google Wallet account currently active on the device. The OPC
     * is scoped to this wallet.
     *
     * If no wallet is active this does NOT return an empty value: the underlying
     * Task fails with an [com.google.android.gms.common.api.ApiException] whose
     * `statusCode` is [TapAndPay.TAP_AND_PAY_NO_ACTIVE_WALLET]. Callers should
     * catch that specific status code and handle it as a normal, expected state
     * (e.g. prompt the user to set up Google Wallet) rather than treating it as a
     * generic error.
     */
    suspend fun getActiveWalletId(): String =
        // A NO_ACTIVE_WALLET ApiException here means "no wallet yet", not a failure;
        // callers should branch on TapAndPay.TAP_AND_PAY_NO_ACTIVE_WALLET.
        client.activeWalletId.awaitTask()

    // -----------------------------------------------------------------------
    // Duplicate detection
    // -----------------------------------------------------------------------

    /**
     * Returns true if a card with the given [lastDigits] is already tokenized on
     * this device for the given [network] + [tokenServiceProvider]. Use this to
     * hide the "Add to Google Wallet" button (or show an "Added" state) so the
     * user cannot create a duplicate token.
     *
     * @param network a TapAndPay.CARD_NETWORK_* int.
     * @param tokenServiceProvider a TapAndPay.TOKEN_PROVIDER_* int.
     */
    suspend fun isCardTokenized(
        lastDigits: String,
        network: Int,
        tokenServiceProvider: Int,
    ): Boolean {
        val request = IsTokenizedRequest.Builder()
            .setIdentifier(lastDigits) // last 4 digits (FPAN identifier)
            .setNetwork(network)
            .setTokenServiceProvider(tokenServiceProvider)
            .build()
        return client.isTokenized(request).awaitTask()
    }

    // -----------------------------------------------------------------------
    // Push tokenization
    // -----------------------------------------------------------------------

    /**
     * Launches the Google Pay push-provisioning UI for the given OPC.
     *
     * This does NOT block and does NOT return the outcome directly — Google Pay
     * shows its own Activity (terms, confirmation, etc.) and the result arrives in
     * the host Activity's `onActivityResult` with [REQUEST_CODE_PUSH_TOKENIZE].
     * Route that back through [handleActivityResult].
     *
     * @param opc decoded Opaque Payment Card bytes (base64-decode the issuer's `opc`).
     * @param network TapAndPay.CARD_NETWORK_* int.
     * @param tsp TapAndPay.TOKEN_PROVIDER_* int.
     * @param displayName label shown on the Wallet tile.
     * @param lastDigits last digits shown on the tile.
     * @param userAddress optional billing address to prefill Google's ID&V step;
     *        pass a fully built [UserAddress] to reduce user friction, or null.
     */
    fun pushTokenize(
        activity: Activity,
        opc: ByteArray,
        network: Int,
        tsp: Int,
        displayName: String,
        lastDigits: String,
        userAddress: UserAddress? = null,
    ) {
        val requestBuilder = PushTokenizeRequest.Builder()
            .setOpaquePaymentCard(opc)
            .setNetwork(network)
            .setTokenServiceProvider(tsp)
            .setDisplayName(displayName)
            .setLastDigits(lastDigits)

        // setUserAddress is optional; only set it when we actually have one.
        if (userAddress != null) {
            requestBuilder.setUserAddress(userAddress)
        }

        val request: PushTokenizeRequest = requestBuilder.build()

        // Launches Google Pay's provisioning UI; result -> onActivityResult.
        client.pushTokenize(activity, request, REQUEST_CODE_PUSH_TOKENIZE)
    }

    /**
     * Translates the raw Activity result of a [pushTokenize] call into a
     * [ProvisioningResult].
     *
     * Call this from your Activity's `onActivityResult`. Returns null if the
     * [requestCode] is not ours (so the caller can delegate to super / other flows).
     */
    fun handleActivityResult(
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ): ProvisioningResult? {
        if (requestCode != REQUEST_CODE_PUSH_TOKENIZE) return null

        return when (resultCode) {
            Activity.RESULT_OK -> {
                // On success Google echoes the issuer token id (best effort).
                val tokenId = data?.getStringExtra(TapAndPay.EXTRA_ISSUER_TOKEN_ID)
                Log.i(TAG, "Push tokenization succeeded, issuerTokenId=$tokenId")
                ProvisioningResult.Success(tokenId)
            }

            Activity.RESULT_CANCELED -> {
                Log.i(TAG, "Push tokenization cancelled by user")
                ProvisioningResult.Cancelled
            }

            TapAndPay.RESULT_FAILED -> {
                Log.w(TAG, "Push tokenization failed (RESULT_FAILED)")
                ProvisioningResult.Failed("Google Pay reported RESULT_FAILED")
            }

            else -> {
                Log.w(TAG, "Push tokenization: unexpected resultCode=$resultCode")
                ProvisioningResult.Failed("Unexpected resultCode=$resultCode")
            }
        }
    }

    // -----------------------------------------------------------------------
    // Token lifecycle
    // -----------------------------------------------------------------------

    /**
     * Registers a listener that fires whenever the set of tokens on the device
     * changes (token created, activated, suspended, deleted...). Google does not
     * hand you the delta directly — on each callback you re-query state (e.g.
     * [isCardTokenized]) and refresh the UI.
     *
     * Token *states* are exposed via TapAndPay.TOKEN_STATE_* constants
     * (UNTOKENIZED, PENDING, NEEDS_IDENTITY_VERIFICATION, SUSPENDED, ACTIVE,
     * FELICA_PENDING_PROVISIONING).
     */
    fun registerDataChangedListener(onChanged: () -> Unit) {
        // Avoid double-registration.
        unregisterDataChangedListener()
        val listener = TapAndPay.DataChangedListener { onChanged() }
        client.registerDataChangedListener(listener)
        dataChangedListener = listener
        Log.d(TAG, "DataChangedListener registered")
    }

    /** Unregisters any previously registered DataChangedListener. */
    fun unregisterDataChangedListener() {
        dataChangedListener?.let {
            client.unregisterDataChangedListener(it)
            Log.d(TAG, "DataChangedListener unregistered")
        }
        dataChangedListener = null
    }
}

// ---------------------------------------------------------------------------
// Task<> -> coroutine bridge.
//
// This project depends on kotlinx-coroutines-play-services, which provides
// `Task<T>.await()`. We still ship this local helper so the manager works even
// if that dependency is dropped: it wraps a Play Services Task in a cancellable
// coroutine and is functionally equivalent to the official `await()`.
// ---------------------------------------------------------------------------

private suspend fun <T> Task<T>.awaitTask(): T =
    suspendCancellableCoroutine { cont ->
        // If the Task is already finished, resolve synchronously.
        if (isComplete) {
            val e = exception
            if (e != null) {
                cont.resumeWithException(e)
            } else if (isCanceled) {
                cont.cancel()
            } else {
                @Suppress("UNCHECKED_CAST")
                cont.resume(result as T)
            }
            return@suspendCancellableCoroutine
        }

        addOnSuccessListener { value -> cont.resume(value) }
        addOnFailureListener { error -> cont.resumeWithException(error) }
        addOnCanceledListener { cont.cancel() }
    }
