// swift-tools-version:5.9
//
// Package.swift
//
// Swift Package manifest for the "PushProvisioning" iOS module.
//
// This module implements the client (issuer app) side of Apple In-App
// Provisioning ("push provisioning") — adding a payment card to Apple Wallet
// directly from an issuer's application, without the user re-typing card data.
//
// There are NO external dependencies: PassKit ships with iOS, so we only link
// against system frameworks. The `.iOS(.v15)` deployment target reflects the
// minimum on which the full provisioning UI (`PKAddPaymentPassViewController`)
// and the SwiftUI wrappers in this module behave consistently.
//
import PackageDescription

let package = Package(
    name: "PushProvisioning",
    // PassKit's provisioning APIs are iOS-only; we advertise iOS 15+ so callers
    // building against this package get a clear availability contract.
    platforms: [
        .iOS(.v15)
    ],
    products: [
        // A single library product that host apps can add via SPM.
        .library(
            name: "PushProvisioning",
            targets: ["PushProvisioning"]
        )
    ],
    dependencies: [
        // Intentionally empty. PassKit / Foundation / SwiftUI are system
        // frameworks and require no package dependency declarations.
    ],
    targets: [
        // The core library target. Sources live under
        // Sources/PushProvisioning/. No resources or C interop are needed.
        .target(
            name: "PushProvisioning",
            dependencies: [],
            path: "Sources/PushProvisioning"
        )
    ]
)
