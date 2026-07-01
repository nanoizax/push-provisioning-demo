//
// AddToWalletButton.swift
//
// SwiftUI wrappers around two UIKit/PassKit pieces:
//
//   1. `AddToWalletButton` — a `UIViewRepresentable` around `PKAddPassButton`.
//      PassKit provides the *official* "Add to Apple Wallet" button artwork;
//      Apple's Human Interface Guidelines require using it (not a custom button)
//      to trigger provisioning. We surface a clean SwiftUI API:
//
//          AddToWalletButton(isEnabled: canAdd) { startProvisioning() }
//
//   2. `PaymentPassPresenter` — a `UIViewControllerRepresentable` helper that
//      presents a `PKAddPaymentPassViewController` (built by
//      `WalletProvisioningManager`) over the SwiftUI hierarchy when a bound
//      controller becomes non-nil, and clears the binding on dismissal.
//
import SwiftUI
import PassKit

// MARK: - PKAddPassButton wrapper

/// The official "Add to Apple Wallet" button, styled with PassKit artwork.
///
/// Usage:
/// ```swift
/// AddToWalletButton(isEnabled: manager.canAddCard(...)) {
///     // begin provisioning
/// }
/// ```
public struct AddToWalletButton: UIViewRepresentable {

    /// Whether the button is tappable. When `false` the button is dimmed and
    /// ignores taps (Wallet's own button has no disabled artwork, so we emulate
    /// it with alpha + `isUserInteractionEnabled`).
    private let isEnabled: Bool
    /// The visual style of the PassKit button (defaults to `.black`).
    private let style: PKAddPassButtonStyle
    /// Tap handler.
    private let action: () -> Void

    public init(isEnabled: Bool = true,
                style: PKAddPassButtonStyle = .black,
                action: @escaping () -> Void) {
        self.isEnabled = isEnabled
        self.style = style
        self.action = action
    }

    public func makeUIView(context: Context) -> PKAddPassButton {
        let button = PKAddPassButton(addPassButtonStyle: style)
        // Route UIKit target/action through the Coordinator into our closure.
        button.addTarget(context.coordinator,
                         action: #selector(Coordinator.handleTap),
                         for: .touchUpInside)
        return button
    }

    public func updateUIView(_ uiView: PKAddPassButton, context: Context) {
        // Keep the coordinator's closure current (closures can capture new state
        // on each SwiftUI update).
        context.coordinator.action = action
        // Emulate an enabled/disabled appearance.
        uiView.isUserInteractionEnabled = isEnabled
        uiView.alpha = isEnabled ? 1.0 : 0.4
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    /// Bridges UIKit target/action to the SwiftUI closure.
    public final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }

        @objc func handleTap() { action() }
    }
}

// MARK: - PKAddPaymentPassViewController presenter

/// Presents a `PKAddPaymentPassViewController` from SwiftUI.
///
/// Bind a `controller` optional: set it to a controller (built by
/// `WalletProvisioningManager.makeProvisioningController(...)`) to present, and
/// this view resets it to `nil` after the sheet is dismissed.
///
/// This is implemented as a hidden `UIViewControllerRepresentable`; embed it in
/// your view tree (e.g. as a `.background(...)`) so it has a host to present on.
public struct PaymentPassPresenter: UIViewControllerRepresentable {

    /// The controller to present. When non-nil, it is presented; the binding is
    /// cleared once presentation begins so we don't re-present on every update.
    @Binding public var controller: PKAddPaymentPassViewController?

    public init(controller: Binding<PKAddPaymentPassViewController?>) {
        self._controller = controller
    }

    public func makeUIViewController(context: Context) -> UIViewController {
        // An invisible host whose only job is to present the Wallet sheet.
        UIViewController()
    }

    public func updateUIViewController(_ host: UIViewController, context: Context) {
        guard let toPresent = controller else { return }

        // Avoid presenting twice if SwiftUI re-invokes update before we clear.
        guard host.presentedViewController == nil else { return }

        // Present on the next runloop tick; presenting synchronously from within
        // `updateUIViewController` can conflict with SwiftUI's own layout pass.
        DispatchQueue.main.async {
            // Clear the binding first so a re-render doesn't try to present again.
            self.controller = nil
            host.present(toPresent, animated: true)
        }
    }
}

// MARK: - Convenience view modifier

public extension View {
    /// Attaches a hidden presenter that shows the bound Wallet controller when it
    /// becomes non-nil. Mirrors the ergonomics of `.sheet(item:)`.
    ///
    /// ```swift
    /// SomeView()
    ///     .paymentPassSheet(controller: $manager.controller)
    /// ```
    func paymentPassSheet(
        controller: Binding<PKAddPaymentPassViewController?>
    ) -> some View {
        background(PaymentPassPresenter(controller: controller))
    }
}
