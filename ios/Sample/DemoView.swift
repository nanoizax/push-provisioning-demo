//
// DemoView.swift
//
// A self-contained SwiftUI demo screen that exercises the full push-provisioning
// flow:
//
//   * On appear, it runs an eligibility check against the issuer backend.
//   * If eligible, it renders a card preview and enables the official
//     "Add to Apple Wallet" button.
//   * Tapping the button builds and presents PKAddPaymentPassViewController via
//     WalletProvisioningManager, then reports the result as status text.
//
// This file belongs to the SAMPLE app target, not the library. It imports the
// PushProvisioning module. Wire the entitlements file (../Sample/
// PushProvisioning.entitlements) to your app target and run on a REAL device
// with an eligible Apple ID — the flow does nothing on the Simulator.
//
import SwiftUI
import UIKit
import PassKit
import PushProvisioning

struct DemoView: View {

    // MARK: Configuration

    /// The issuer client. Default base URL is http://localhost:8787. Point this
    /// at your running demo backend (or a tunnel to it). The fake card id
    /// ("card_demo_visa_4242") is held by the view model.
    private let apiClient = IssuerAPIClient()

    /// The provisioning manager, created once and reused across attempts.
    @StateObject private var model = DemoModel(cardId: "card_demo_visa_4242")

    var body: some View {
        VStack(spacing: 24) {
            cardPreview

            statusSection

            Spacer()

            // Official Apple Wallet button. Enabled only when the card is
            // eligible AND the device/account can add it AND it isn't already
            // provisioned (all folded into `model.canAdd`).
            AddToWalletButton(isEnabled: model.canAdd) {
                model.startProvisioning(using: apiClient)
            }
            .frame(height: 48)
            .opacity(model.isEligible ? 1 : 0)          // hide until we know
            .animation(.default, value: model.isEligible)
        }
        .padding()
        // Hidden presenter that shows the Wallet sheet when the manager produces
        // a controller. Uses the convenience modifier from AddToWalletButton.swift.
        .paymentPassSheet(controller: $model.controller)
        .task {
            // Kick off the eligibility check when the view first appears.
            await model.checkEligibility(using: apiClient)
        }
        .navigationTitle("Add Card to Wallet")
    }

    // MARK: Subviews

    /// A simple card visual using the eligibility metadata (or placeholders).
    private var cardPreview: some View {
        RoundedRectangle(cornerRadius: 16)
            .fill(
                LinearGradient(colors: [.indigo, .blue],
                               startPoint: .topLeading,
                               endPoint: .bottomTrailing)
            )
            .frame(height: 200)
            .overlay(
                VStack(alignment: .leading, spacing: 12) {
                    Text(model.localizedDescription ?? "SonhoLab Debit")
                        .font(.headline)
                        .foregroundColor(.white.opacity(0.9))
                    Spacer()
                    Text("•••• •••• •••• \(model.primaryAccountSuffix ?? "4242")")
                        .font(.system(.title3, design: .monospaced))
                        .foregroundColor(.white)
                    HStack {
                        Text(model.cardholderName ?? "Leandro Perez")
                            .foregroundColor(.white.opacity(0.9))
                        Spacer()
                        Text(model.networkLabel)
                            .fontWeight(.semibold)
                            .foregroundColor(.white)
                    }
                    .font(.subheadline)
                }
                .padding()
            )
            .shadow(radius: 8)
    }

    /// Eligibility + provisioning status text.
    private var statusSection: some View {
        VStack(spacing: 8) {
            if model.isChecking {
                ProgressView("Checking eligibility…")
            }
            Text(model.statusText)
                .font(.callout)
                .foregroundColor(model.isError ? .red : .secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - View model

/// Observable model that owns the flow state and the manager. Marked
/// `@MainActor` so its published state mutations are UI-safe.
@MainActor
final class DemoModel: ObservableObject {

    private let cardId: String
    /// The manager is stateful across the sheet's lifetime, so we retain it.
    private let manager: WalletProvisioningManager

    // Published UI state.
    @Published var controller: PKAddPaymentPassViewController?
    @Published var isChecking = false
    @Published var isEligible = false
    @Published var canAdd = false
    @Published var statusText = "Preparing…"
    @Published var isError = false

    // Card metadata captured from eligibility for the preview.
    @Published var cardholderName: String?
    @Published var primaryAccountSuffix: String?
    @Published var localizedDescription: String?
    private var network: CardNetwork?
    private var eligibility: EligibilityResponse?

    var networkLabel: String {
        switch network {
        case .visa: return "VISA"
        case .mastercard: return "Mastercard"
        case .none: return ""
        }
    }

    init(cardId: String) {
        self.cardId = cardId
        self.manager = WalletProvisioningManager(cardId: cardId)
    }

    /// Runs the eligibility check and updates capability flags.
    func checkEligibility(using client: IssuerAPIClient) async {
        isChecking = true
        isError = false
        statusText = "Checking eligibility…"
        defer { isChecking = false }

        do {
            // A stable device id. In production derive/persist your own; here we
            // reuse identifierForVendor which is stable per install per vendor.
            // This model is @MainActor, so touching UIDevice is main-thread safe.
            let deviceId = UIDevice.current.identifierForVendor?.uuidString
                ?? "demo-device"

            let response = try await client.checkEligibility(cardId: cardId,
                                                             deviceId: deviceId)
            self.eligibility = response
            self.cardholderName = response.cardholderName
            self.primaryAccountSuffix = response.primaryAccountSuffix
            self.localizedDescription = response.localizedDescription
            self.network = response.network

            guard response.eligible else {
                isEligible = false
                canAdd = false
                statusText = response.reason ?? "This card is not eligible."
                return
            }

            isEligible = true
            // Fold the device capability + dedupe check into `canAdd`.
            canAdd = manager.canAddCard(
                primaryAccountIdentifier: response.primaryAccountIdentifier
            )
            statusText = canAdd
                ? "Eligible — tap “Add to Apple Wallet”."
                : "Card is eligible, but it can’t be added on this device "
                  + "(already added, or Simulator / unsupported Apple ID)."
        } catch {
            isEligible = false
            canAdd = false
            isError = true
            statusText = (error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription
        }
    }

    /// Builds and presents the Wallet sheet.
    func startProvisioning(using client: IssuerAPIClient) {
        guard let eligibility else {
            statusText = "Run the eligibility check first."
            return
        }
        isError = false
        statusText = "Opening Apple Wallet…"

        // Build the controller; nil means the device can't add a pass right now.
        guard let controller = manager.makeProvisioningController(
            eligibility: eligibility,
            completion: { [weak self] result in
                self?.handle(result)
            }
        ) else {
            isError = true
            statusText = "Unable to start provisioning on this device."
            return
        }

        // Publish the controller so the hidden presenter shows the sheet.
        self.controller = controller
    }

    /// Maps the final provisioning result to status text.
    private func handle(_ result: ProvisioningResult) {
        switch result {
        case .added:
            isError = false
            canAdd = false                 // now provisioned — disable the button
            statusText = "✅ Card added to Apple Wallet."
        case .cancelled:
            isError = false
            statusText = "Cancelled. You can try again."
        case .failed(let error):
            isError = true
            statusText = "❌ " + ((error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription)
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationView {
        DemoView()
    }
}
