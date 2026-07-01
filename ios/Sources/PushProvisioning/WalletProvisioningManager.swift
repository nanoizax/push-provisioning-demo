//
// WalletProvisioningManager.swift
//
// The heart of the iOS push-provisioning flow. This class orchestrates PassKit's
// In-App Provisioning UI and bridges it to the issuer backend.
//
// The Apple flow, end to end:
//   1. Capability check  — can this device/account add a payment pass at all, and
//                          is this specific card not already provisioned?
//   2. Configuration     — build a PKAddPaymentPassRequestConfiguration with the
//                          display + routing metadata from the eligibility call.
//   3. Presentation      — present PKAddPaymentPassViewController.
//   4. Delegate handshake — Wallet asks us to "generate a request" and hands us a
//                          certificate chain (leaf + sub-CA), a nonce, and a
//                          nonce signature. We forward these to the issuer, which
//                          (with the network TSP) returns the encrypted card data.
//                          We wrap that in a PKAddPaymentPassRequest and hand it
//                          back to Wallet via the completion handler.
//   5. Completion         — Wallet reports success/failure via didFinishAdding.
//
// Concurrency: the whole class is @MainActor because it touches UIKit and drives
// UI. The single network hop in step 4 is `async` and runs on the main actor's
// executor via a `Task`; the actual URLSession work happens off-main inside the
// client, and we hop back to complete the PassKit handler on the main thread.
//
import Foundation
import PassKit

/// Result reported back to the caller once Wallet finishes adding (or fails).
public enum ProvisioningResult: Equatable {
    /// Wallet successfully added the pass. Carries the added pass, if provided.
    case added(PKPaymentPass?)
    /// The user cancelled, or Wallet reported an error.
    case failed(Error)
    /// The user dismissed the sheet without adding (no error).
    case cancelled

    public static func == (lhs: ProvisioningResult, rhs: ProvisioningResult) -> Bool {
        switch (lhs, rhs) {
        case let (.added(l), .added(r)):
            return l === r
        case (.cancelled, .cancelled):
            return true
        case let (.failed(l), .failed(r)):
            return (l as NSError) == (r as NSError)
        default:
            return false
        }
    }
}

@MainActor
public final class WalletProvisioningManager: NSObject {

    // MARK: Dependencies / state

    /// The issuer API client used for the provisioning round-trip.
    private let apiClient: IssuerAPIClient
    /// The issuer's card id we are provisioning (path/body parameter).
    private let cardId: String

    /// Eligibility metadata, captured when the caller starts a flow. Needed both
    /// to build the configuration and, later, for `primaryAccountIdentifier`.
    private var eligibility: EligibilityResponse?

    /// Completion invoked exactly once when the flow terminates.
    private var flowCompletion: ((ProvisioningResult) -> Void)?

    /// Reference to the presented controller, kept only so we can clear it on
    /// finish. Declared `weak` to avoid a retain cycle: the controller strongly
    /// holds this manager as its delegate, so the presenter (the SwiftUI wrapper /
    /// caller that presents it) must own the controller's lifetime, not us.
    private weak var presentedController: PKAddPaymentPassViewController?

    /// Guards against a double completion (PassKit can, in edge cases, message a
    /// delegate more than once during teardown).
    private var didFinish = false

    /// Holds an error produced during the certificate/issuer handshake so it can
    /// be reported later from `didFinishAdding` — which is where the flow truly
    /// ends. A plain stored property is safe here because the whole class is
    /// `@MainActor`, so all access is serialized on the main actor.
    private var pendingHandshakeError: Error?

    // MARK: Init

    /// - Parameters:
    ///   - cardId: The issuer card identifier to provision.
    ///   - apiClient: Issuer client (default points at localhost:8787).
    public init(cardId: String,
                apiClient: IssuerAPIClient = IssuerAPIClient()) {
        self.cardId = cardId
        self.apiClient = apiClient
        super.init()
    }

    // MARK: - Capability checks

    /// Whether the "Add to Apple Wallet" button should be shown / enabled.
    ///
    /// Combines two orthogonal checks:
    ///
    ///  * `PKAddPaymentPassViewController.canAddPaymentPass()` — device + Apple ID
    ///    are capable of in-app provisioning at all (correct hardware, region,
    ///    signed-in Apple ID). This is `false` on the Simulator.
    ///
    ///  * `PKPassLibrary().canAddPaymentPass(withPrimaryAccountIdentifier:)` —
    ///    returns `false` when a card with this `primaryAccountIdentifier` is
    ///    *already* provisioned (on this device or a paired Apple Watch). We use
    ///    it to avoid offering a duplicate. When the issuer returns an EMPTY
    ///    identifier we skip this second check (we simply can't dedupe), which is
    ///    the documented behavior for that overload with an empty string.
    ///
    /// - Parameter primaryAccountIdentifier: The opaque identifier from the
    ///   eligibility response. Pass an empty string to skip the dedupe check.
    /// - Returns: `true` if the button should be actionable.
    public func canAddCard(primaryAccountIdentifier: String) -> Bool {
        // 1) Is in-app provisioning available on this device/account?
        guard PKAddPaymentPassViewController.canAddPaymentPass() else {
            return false
        }

        // 2) Is the card NOT already provisioned? Only meaningful with a real id.
        if primaryAccountIdentifier.isEmpty {
            return true
        }
        return PKPassLibrary()
            .canAddPaymentPass(withPrimaryAccountIdentifier: primaryAccountIdentifier)
    }

    // MARK: - Flow entry point

    /// Builds the provisioning configuration and returns a fully configured
    /// `PKAddPaymentPassViewController` ready to be presented, or `nil` if the
    /// device/account cannot add a pass (caller should keep the button hidden).
    ///
    /// The returned controller has `self` as its delegate; retain `self` for the
    /// lifetime of the sheet. Present it with the SwiftUI wrapper in
    /// `AddToWalletButton.swift` or from a `UIViewController`.
    ///
    /// - Parameters:
    ///   - eligibility: The eligibility response describing the card.
    ///   - completion: Invoked once when the flow ends (added / cancelled /
    ///     failed). Always called on the main actor.
    public func makeProvisioningController(
        eligibility: EligibilityResponse,
        completion: @escaping (ProvisioningResult) -> Void
    ) -> PKAddPaymentPassViewController? {

        // Re-entry guard: if a previous flow was started but never finished,
        // terminate it as cancelled so its caller is always notified before we
        // overwrite the per-flow state below (otherwise its completion is lost).
        if flowCompletion != nil && !didFinish {
            finish(.cancelled)
        }

        // Reset per-flow state (this manager can drive multiple attempts).
        self.eligibility = eligibility
        self.flowCompletion = completion
        self.didFinish = false

        // Guard again in case availability changed since the button was shown.
        guard PKAddPaymentPassViewController.canAddPaymentPass() else {
            completion(.failed(IssuerError.notEligible(
                reason: "In-app provisioning is not available on this device.")))
            return nil
        }

        let configuration = makeConfiguration(from: eligibility)

        // The initializer is failable: it returns nil if the configuration is
        // invalid or provisioning is unsupported.
        guard let controller = PKAddPaymentPassViewController(
            requestConfiguration: configuration,
            delegate: self
        ) else {
            completion(.failed(IssuerError.notEligible(
                reason: "Could not create the Add Payment Pass controller.")))
            return nil
        }

        self.presentedController = controller
        return controller
    }

    /// Maps the issuer eligibility metadata onto a PassKit configuration.
    ///
    /// `encryptionScheme: .ECC_V2` selects the modern elliptic-curve scheme used
    /// by current Visa VDEP / Mastercard MDES flows; it pairs with the
    /// `ephemeralPublicKey` we set on the resulting request in step 4.
    private func makeConfiguration(
        from eligibility: EligibilityResponse
    ) -> PKAddPaymentPassRequestConfiguration {

        // `init(encryptionScheme:)` is failable in the SDK signature; ECC_V2 is
        // always supported on iOS 15+, so the force-unwrap is safe here. We keep
        // it explicit rather than hiding it behind an optional to make the intent
        // clear: a nil here would be a programmer/SDK error, not a runtime path.
        let configuration = PKAddPaymentPassRequestConfiguration(
            encryptionScheme: .ECC_V2
        )!

        // Display + routing metadata. Wallet shows these to the user on the sheet.
        configuration.cardholderName = eligibility.cardholderName
        configuration.primaryAccountSuffix = eligibility.primaryAccountSuffix
        configuration.localizedDescription = eligibility.localizedDescription

        // Opaque funding-account identifier. When present it lets Wallet relate
        // this request to an existing provisioned card (dedupe / Apple Watch).
        if !eligibility.primaryAccountIdentifier.isEmpty {
            configuration.primaryAccountIdentifier = eligibility.primaryAccountIdentifier
        }

        // Map our network enum onto PassKit's PKPaymentNetwork constants.
        configuration.paymentNetwork = Self.paymentNetwork(for: eligibility.network)

        return configuration
    }

    /// Translates our `CardNetwork` into the corresponding `PKPaymentNetwork`.
    private static func paymentNetwork(for network: CardNetwork) -> PKPaymentNetwork {
        switch network {
        case .visa:
            return .visa
        case .mastercard:
            return .masterCard
        }
    }

    // MARK: - Completion plumbing

    /// Reports the final result to the caller exactly once and clears per-flow
    /// state so the manager can be reused.
    private func finish(_ result: ProvisioningResult) {
        guard !didFinish else { return }
        didFinish = true
        let completion = flowCompletion
        flowCompletion = nil
        presentedController = nil
        completion?(result)
    }
}

// MARK: - PKAddPaymentPassViewControllerDelegate

extension WalletProvisioningManager: PKAddPaymentPassViewControllerDelegate {

    /// Step 4 — the core handshake.
    ///
    /// Wallet has generated a certificate chain and a nonce for THIS request and
    /// is asking us to produce a `PKAddPaymentPassRequest`. We:
    ///   1. Extract the leaf + sub-CA certificates (as DER `Data`).
    ///   2. POST them, with the nonce and nonce signature, to the issuer.
    ///   3. Decode the issuer's Base64 payload into `Data`.
    ///   4. Populate a `PKAddPaymentPassRequest` and call `handler(request)`.
    ///
    /// On any failure we still MUST call the handler (with an empty request) so
    /// Wallet can tear down gracefully; we also surface the error to the caller.
    public func addPaymentPassViewController(
        _ controller: PKAddPaymentPassViewController,
        generateRequestWithCertificateChain certificates: [SecCertificate],
        nonce: Data,
        nonceSignature: Data,
        completionHandler handler: @escaping (PKAddPaymentPassRequest) -> Void
    ) {
        // PassKit hands the chain as [leaf, intermediate(sub-CA), ...]. The
        // contract expects [leaf, subCA]; convert each SecCertificate to its DER
        // bytes via SecCertificateCopyData.
        let derCertificates: [Data] = certificates.map { cert in
            SecCertificateCopyData(cert) as Data
        }

        // Perform the issuer round-trip. This is async; when it resolves we hop
        // back onto the main actor (guaranteed by @MainActor on the Task body) to
        // build the request and invoke Wallet's handler.
        Task { [weak self] in
            guard let self else {
                // If the manager was deallocated, still unblock Wallet.
                handler(PKAddPaymentPassRequest())
                return
            }
            do {
                let response = try await self.apiClient.requestAppleProvisioning(
                    cardId: self.cardId,
                    certificates: derCertificates,
                    nonce: nonce,
                    nonceSignature: nonceSignature
                )

                // Decode the three Base64 fields into raw Data. Any malformed
                // field throws IssuerError.invalidBase64 and lands in `catch`.
                let activationData = try response.decodedActivationData()
                let encryptedPassData = try response.decodedEncryptedPassData()
                let ephemeralPublicKey = try response.decodedEphemeralPublicKey()

                // Assemble the request Wallet needs to finalize provisioning.
                let request = PKAddPaymentPassRequest()
                request.activationData = activationData
                request.encryptedPassData = encryptedPassData
                request.ephemeralPublicKey = ephemeralPublicKey

                // Hand the completed request back to Wallet.
                handler(request)
            } catch {
                // Record the error for the final completion, then unblock Wallet
                // with an empty request. Wallet will subsequently call
                // didFinishAdding with its own error; we prefer OUR richer error,
                // so stash it and let finish() report it there.
                self.pendingHandshakeError = error
                handler(PKAddPaymentPassRequest())
            }
        }
    }

    /// Step 5 — Wallet finished (or failed to add) the pass.
    ///
    /// We prefer the specific error captured during the handshake (network /
    /// decoding / Base64) over PassKit's generic error, since it's more
    /// actionable. If neither is present and there is no pass, we treat it as a
    /// user cancellation.
    public func addPaymentPassViewController(
        _ controller: PKAddPaymentPassViewController,
        didFinishAdding pass: PKPaymentPass?,
        error: Error?
    ) {
        // Dismiss the sheet we presented.
        controller.dismiss(animated: true)

        if let pass, error == nil, pendingHandshakeError == nil {
            finish(.added(pass))
            return
        }

        if let handshakeError = pendingHandshakeError {
            pendingHandshakeError = nil
            finish(.failed(handshakeError))
            return
        }

        if let error {
            finish(.failed(error))
            return
        }

        // No pass, no error: the user dismissed the sheet.
        finish(.cancelled)
    }
}
