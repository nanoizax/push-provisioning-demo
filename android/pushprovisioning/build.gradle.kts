// ---------------------------------------------------------------------------
// :pushprovisioning — reusable Android library that wraps Google's TapAndPay
// (Google Pay Push Provisioning) API and the issuer HTTP contract.
//
// This module is UI-light (only the Compose "Add to Google Wallet" button) and
// deliberately has no dependency on the :app module, so it can be dropped into
// any issuer application.
// ---------------------------------------------------------------------------

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    // Kotlin 2.0 Compose compiler plugin — required because this module exposes
    // a @Composable button.
    id("org.jetbrains.kotlin.plugin.compose")
    // kapt drives Moshi's codegen annotation processor (@JsonClass(generateAdapter = true)).
    id("org.jetbrains.kotlin.kapt")
}

android {
    namespace = "com.sonholab.pushprovisioning"
    compileSdk = 34

    defaultConfig {
        minSdk = 24 // Google Pay / TapAndPay requires a reasonably modern OS.
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        // The "Add to Google Wallet" button is written in Jetpack Compose.
        compose = true
    }
}

dependencies {
    // --- Google Play Services -------------------------------------------------
    // TapAndPay is the client library for Google Pay Push Provisioning. This is
    // the artifact that provides TapAndPay, TapAndPayClient, PushTokenizeRequest,
    // IsTokenizedRequest, UserAddress and all the CARD_NETWORK_* / TOKEN_* ints.
    implementation("com.google.android.gms:play-services-tapandpay:18.3.3")
    // play-services-base pulls in Task<>, GoogleApiClient plumbing, and the
    // ApiException type that TapAndPay tasks fail with.
    implementation("com.google.android.gms:play-services-base:18.5.0")
    // Bridges Google Play Services Task<> to Kotlin coroutines via `.await()`.
    // (If you prefer not to add this, PushProvisioningManager also ships a
    // suspendCancellableCoroutine helper — but this dependency is the clean way.)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")

    // --- Coroutines -----------------------------------------------------------
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // --- Networking (issuer backend) -----------------------------------------
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    // Moshi converter so Retrofit can (de)serialize the @JsonClass models.
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    implementation("com.squareup.moshi:moshi:1.15.1")
    // Codegen generates the JsonAdapters at compile time (no reflection at runtime).
    kapt("com.squareup.moshi:moshi-kotlin-codegen:1.15.1")
    // OkHttp logging interceptor for debugging the issuer round-trips.
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // --- Jetpack Compose ------------------------------------------------------
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.9.2")
}
