// ---------------------------------------------------------------------------
// Root Gradle settings for the Push Provisioning demo.
//
// Two Gradle modules:
//   :app             -> the demo issuer application (Compose UI, MainActivity)
//   :pushprovisioning -> the reusable library that wraps Google's TapAndPay API
//
// pluginManagement + dependencyResolutionManagement are centralized here so that
// every module resolves plugins and dependencies from the same repositories.
// ---------------------------------------------------------------------------

pluginManagement {
    repositories {
        // google() must come first: it hosts the Android Gradle Plugin (AGP)
        // and Google Play Services artifacts (including play-services-tapandpay).
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // Fail the build if a module declares its own repositories: we want a single,
    // predictable resolution surface for a payments-grade dependency graph.
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "push-provisioning-demo"

include(":app")
include(":pushprovisioning")
