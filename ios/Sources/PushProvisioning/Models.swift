//
// Models.swift
//
// Codable models that mirror the *issuer backend* contract. These are the wire
// types exchanged between the iOS app and the issuer server — NOT PassKit types.
//
// Base64 handling notes
// ---------------------
// Several fields in the provisioning exchange are binary (DER-encoded X.509
// certificates, a nonce, a nonce signature, and the encrypted card payload).
// JSON cannot carry raw bytes, so the contract transports every binary field as
// a **standard, un-padded-optional Base64 string** (RFC 4648, `+`/`/` alphabet,
// `=` padding allowed). On the Swift side these map to `Data`:
//
//   * Encoding  (Data -> wire):  `data.base64EncodedString()`
//   * Decoding  (wire -> Data):  `Data(base64Encoded: string)`
//
// We keep the Base64 as `String` in these DTOs (a faithful representation of the
// JSON) and perform the `Data` <-> Base64 conversion at the boundaries
// (IssuerAPIClient / WalletProvisioningManager) so the models stay pure and the
// conversion is explicit and testable. `Data(base64Encoded:)` is strict: any
// malformed Base64 yields `nil`, which we surface as `IssuerError.invalidBase64`.
//
import Foundation

// MARK: - Eligibility

/// Body for `POST /v1/cards/{cardId}/eligibility`.
///
/// Asks the issuer whether a given card can be provisioned onto Apple Wallet on
/// this specific device. `walletPlatform` is fixed to `"apple"` for this module
/// (the same backend may also serve Google Wallet with `"google"`).
public struct EligibilityRequest: Codable, Equatable {
    /// Always `"apple"` for the iOS client.
    public let walletPlatform: String
    /// A stable, app-generated identifier for the device (see notes below).
    public let deviceId: String

    public init(walletPlatform: String = "apple", deviceId: String) {
        self.walletPlatform = walletPlatform
        self.deviceId = deviceId
    }
}

/// Payment networks the demo backend understands. Kept as a small closed enum so
/// callers can `switch` exhaustively; decoding is tolerant of casing.
public enum CardNetwork: String, Codable, Equatable {
    case visa
    case mastercard

    /// Case-insensitive decoding so `"Visa"`, `"VISA"`, `"mastercard"` all work.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw.lowercased() {
        case "visa":
            self = .visa
        case "mastercard", "master-card", "master_card":
            self = .mastercard
        default:
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath,
                      debugDescription: "Unknown card network: \(raw)")
            )
        }
    }
}

/// Response 200 for the eligibility endpoint.
///
/// When `eligible == true`, the remaining fields are the display + routing
/// metadata used to build the PassKit provisioning configuration:
///   * `cardholderName`            -> configuration.cardholderName
///   * `primaryAccountSuffix`      -> configuration.primaryAccountSuffix
///   * `localizedDescription`      -> configuration.localizedDescription
///   * `primaryAccountIdentifier`  -> configuration.primaryAccountIdentifier
///     and PKPassLibrary.canAddPaymentPass(withPrimaryAccountIdentifier:)
///   * `network`                   -> configuration.paymentNetwork (mapped)
///
/// When `eligible == false`, `reason` should carry a human-readable explanation.
public struct EligibilityResponse: Codable, Equatable {
    public let eligible: Bool
    public let network: CardNetwork
    public let cardholderName: String
    public let primaryAccountSuffix: String
    public let localizedDescription: String
    /// Opaque, issuer-assigned identifier for the *funding* account. May be an
    /// empty string when the issuer does not expose one. When non-empty it lets
    /// Wallet detect a card that is already provisioned on this device (or a
    /// paired Apple Watch), so we don't offer a duplicate "Add" button.
    public let primaryAccountIdentifier: String
    /// Present (non-nil) only when `eligible == false`.
    public let reason: String?

    public init(eligible: Bool,
                network: CardNetwork,
                cardholderName: String,
                primaryAccountSuffix: String,
                localizedDescription: String,
                primaryAccountIdentifier: String,
                reason: String?) {
        self.eligible = eligible
        self.network = network
        self.cardholderName = cardholderName
        self.primaryAccountSuffix = primaryAccountSuffix
        self.localizedDescription = localizedDescription
        self.primaryAccountIdentifier = primaryAccountIdentifier
        self.reason = reason
    }
}

// MARK: - Apple provisioning

/// Body for `POST /v1/provisioning/apple`.
///
/// This is sent from inside PassKit's delegate callback. The `certificates`,
/// `nonce`, and `nonceSignature` all originate from Apple/Wallet and are passed
/// straight through to the issuer (who forwards them to the network TSP — Visa
/// VDEP or Mastercard MDES — to obtain the encrypted card data).
///
/// `certificates` is ordered **[leaf, sub-CA]** exactly as PassKit hands it to
/// us in the certificate chain. Every element is Base64(DER).
public struct AppleProvisioningRequest: Codable, Equatable {
    public let cardId: String
    /// `[base64(leaf DER), base64(subCA DER)]`.
    public let certificates: [String]
    /// Base64 of the one-time nonce Wallet generated for this request.
    public let nonce: String
    /// Base64 of Wallet's signature over the nonce (binds the request to Wallet).
    public let nonceSignature: String

    public init(cardId: String,
                certificates: [String],
                nonce: String,
                nonceSignature: String) {
        self.cardId = cardId
        self.certificates = certificates
        self.nonce = nonce
        self.nonceSignature = nonceSignature
    }
}

/// Response 200 for the Apple provisioning endpoint.
///
/// The three binary fields map DIRECTLY onto `PKAddPaymentPassRequest`:
///   * `activationData`     -> PKAddPaymentPassRequest.activationData
///   * `encryptedPassData`  -> PKAddPaymentPassRequest.encryptedPassData
///   * `ephemeralPublicKey` -> PKAddPaymentPassRequest.ephemeralPublicKey
///
/// Each is Base64 on the wire and must be decoded to `Data` before assignment.
/// `reference` is an issuer-side correlation id (e.g. `"prov_xxx"`) useful for
/// support / audit and has no PassKit counterpart.
public struct AppleProvisioningResponse: Codable, Equatable {
    public let activationData: String
    public let encryptedPassData: String
    public let ephemeralPublicKey: String
    public let reference: String

    public init(activationData: String,
                encryptedPassData: String,
                ephemeralPublicKey: String,
                reference: String) {
        self.activationData = activationData
        self.encryptedPassData = encryptedPassData
        self.ephemeralPublicKey = ephemeralPublicKey
        self.reference = reference
    }

    // MARK: Decoded (Data) accessors

    /// Decodes `activationData` from Base64. Throws `IssuerError.invalidBase64`
    /// on malformed input so the caller never silently assigns empty `Data`.
    public func decodedActivationData() throws -> Data {
        try Self.decodeBase64(activationData, field: "activationData")
    }

    /// Decodes `encryptedPassData` from Base64.
    public func decodedEncryptedPassData() throws -> Data {
        try Self.decodeBase64(encryptedPassData, field: "encryptedPassData")
    }

    /// Decodes `ephemeralPublicKey` from Base64.
    public func decodedEphemeralPublicKey() throws -> Data {
        try Self.decodeBase64(ephemeralPublicKey, field: "ephemeralPublicKey")
    }

    /// Strict Base64 -> Data helper. `Data(base64Encoded:)` returns `nil` for any
    /// invalid string; we translate that into a typed error carrying the field
    /// name to make debugging server payloads painless.
    private static func decodeBase64(_ value: String, field: String) throws -> Data {
        guard let data = Data(base64Encoded: value) else {
            throw IssuerError.invalidBase64(field: field)
        }
        return data
    }
}

// MARK: - Errors

/// Errors originating from the issuer boundary: transport, HTTP status, decoding,
/// and Base64 validity. Conforms to `LocalizedError` so the UI can show a message.
public enum IssuerError: Error, LocalizedError, Equatable {
    /// The base URL / request could not be constructed.
    case invalidURL
    /// A non-2xx HTTP status. Carries the status code and any decoded server text.
    case httpStatus(code: Int, body: String?)
    /// The response body could not be decoded into the expected model.
    case decoding(String)
    /// A field that should be Base64 was not decodable to `Data`.
    case invalidBase64(field: String)
    /// The issuer reported the card is not eligible (with an optional reason).
    case notEligible(reason: String?)
    /// Transport-level failure (offline, timeout, TLS, ...). Message from URLError.
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The issuer endpoint URL is invalid."
        case let .httpStatus(code, body):
            if let body, !body.isEmpty {
                return "Issuer returned HTTP \(code): \(body)"
            }
            return "Issuer returned HTTP \(code)."
        case let .decoding(detail):
            return "Could not decode the issuer response. \(detail)"
        case let .invalidBase64(field):
            return "Field \"\(field)\" was not valid Base64."
        case let .notEligible(reason):
            return reason ?? "This card is not eligible for Apple Wallet."
        case let .transport(detail):
            return "Network error contacting the issuer. \(detail)"
        }
    }
}
