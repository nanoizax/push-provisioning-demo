// ---------------------------------------------------------------------------
// Top-level build file.
//
// Plugins are declared here with `apply false` so that their versions are
// pinned in one place; each module then applies the plugin without repeating
// the version. This is the idiomatic AGP 8.x / Kotlin 2.0 setup.
// ---------------------------------------------------------------------------

plugins {
    // Android Gradle Plugin 8.5.x (stable, compatible with Gradle 8.7+).
    id("com.android.application") version "8.5.2" apply false
    id("com.android.library") version "8.5.2" apply false

    // Kotlin 2.0.x. Starting with Kotlin 2.0 the Compose compiler ships as its
    // own Gradle plugin (org.jetbrains.kotlin.plugin.compose) instead of being
    // configured through composeOptions.kotlinCompilerExtensionVersion.
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    // kapt is the annotation processor bridge for Moshi codegen; version-matched
    // to the Kotlin plugin above.
    id("org.jetbrains.kotlin.kapt") version "2.0.21" apply false
}
