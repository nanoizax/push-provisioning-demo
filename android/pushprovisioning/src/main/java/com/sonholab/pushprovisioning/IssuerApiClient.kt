package com.sonholab.pushprovisioning

import com.squareup.moshi.Moshi
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import java.util.concurrent.TimeUnit

/**
 * Retrofit interface for the issuer backend, plus a small factory that wires up
 * OkHttp (bearer auth + logging), Moshi and Retrofit.
 *
 * The manager calls exactly two endpoints:
 *   1. checkEligibility  -> decides whether to offer the "Add to Google Wallet" button.
 *   2. requestGoogleOpc  -> obtains the encrypted OPC just before pushTokenize.
 */
interface IssuerApiService {

    /**
     * POST /v1/cards/{cardId}/eligibility
     *
     * NOTE: The Authorization header is injected globally by [BearerAuthInterceptor],
     * so it is intentionally not declared as a @Header parameter here.
     */
    @POST("v1/cards/{cardId}/eligibility")
    suspend fun checkEligibility(
        @Path("cardId") cardId: String,
        @Body body: EligibilityRequest,
    ): EligibilityResponse

    /**
     * POST /v1/provisioning/google/opc
     *
     * Returns the base64 OPC and the network/TSP strings used to build the
     * PushTokenizeRequest.
     */
    @POST("v1/provisioning/google/opc")
    suspend fun requestGoogleOpc(
        @Body body: GoogleProvisioningRequest,
    ): GoogleOpcResponse
}

/**
 * OkHttp interceptor that attaches the demo bearer token and a JSON content-type
 * to every request. In production this token would be a short-lived session token
 * issued after the user authenticates in the issuer app.
 */
class BearerAuthInterceptor(
    private val tokenProvider: () -> String,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("Authorization", "Bearer ${tokenProvider()}")
            .header("Content-Type", "application/json")
            .build()
        return chain.proceed(request)
    }
}

/**
 * Factory for a configured [IssuerApiService].
 *
 * The default base URL is `http://10.0.2.2:8787`. On the Android emulator,
 * `10.0.2.2` is a special alias that routes to the *host machine's* localhost —
 * i.e. the issuer server running on your dev laptop at `localhost:8787`. On a
 * physical device you must instead point [baseUrl] at your machine's LAN IP (or a
 * tunnel), because `10.0.2.2` only exists inside the emulator's NAT.
 */
object IssuerApiClient {

    const val DEFAULT_BASE_URL: String = "http://10.0.2.2:8787/"
    const val DEFAULT_SESSION_TOKEN: String = "demo-session-token"

    /**
     * @param baseUrl issuer base URL (must end with '/').
     * @param sessionToken bearer token; defaults to the demo session token.
     * @param enableLogging pretty-print request/response bodies to Logcat. Keep
     *        this OFF in production builds — payment payloads must not be logged.
     */
    fun create(
        baseUrl: String = DEFAULT_BASE_URL,
        sessionToken: String = DEFAULT_SESSION_TOKEN,
        enableLogging: Boolean = true,
    ): IssuerApiService {

        val logging = HttpLoggingInterceptor().apply {
            level = if (enableLogging) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }

        val okHttp = OkHttpClient.Builder()
            .addInterceptor(BearerAuthInterceptor { sessionToken })
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

        // The models use @JsonClass(generateAdapter = true), so Moshi resolves
        // compile-time-generated adapters — no reflection factory needed.
        val moshi = Moshi.Builder().build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttp)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(IssuerApiService::class.java)
    }
}
