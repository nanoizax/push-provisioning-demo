//
// IssuerAPIClient.swift
//
// Thin async/await networking client for the *issuer backend* — the server the
// app talks to during push provisioning. It knows nothing about PassKit; it only
// speaks the JSON contract defined in Models.swift.
//
// Design choices
// --------------
//  * `URLSession` + async/await (`data(for:)`) — no third-party HTTP stack.
//  * Bearer-token auth on every request (`Authorization: Bearer <token>`).
//  * A configurable `baseURL` (default `http://localhost:8787`) so the same
//    binary can point at localhost, staging, or production.
//  * All Data<->Base64 conversion happens *here* (or in the models), so the
//    WalletProvisioningManager can pass raw `Data` around and stay clean.
//  * Errors are funneled into the typed `IssuerError` enum.
//
import Foundation

/// Networking client for the issuer backend.
///
/// Marked `Sendable` because it holds only immutable, value-type configuration
/// and a `URLSession`; instances can be shared across concurrency domains.
public final class IssuerAPIClient: @unchecked Sendable {

    // MARK: Configuration

    /// Base URL of the issuer API, e.g. `http://localhost:8787`.
    private let baseURL: URL
    /// Bearer token sent as `Authorization: Bearer <token>`.
    private let sessionToken: String
    /// Underlying URLSession (injectable for tests / custom configuration).
    private let session: URLSession
    /// Shared JSON coders configured once.
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    /// Creates a client.
    ///
    /// - Parameters:
    ///   - baseURL: Issuer API base. Defaults to `http://localhost:8787`.
    ///   - sessionToken: Bearer token. Defaults to the demo token from the
    ///     contract (`"demo-session-token"`). In a real app this is the
    ///     authenticated user's short-lived session token.
    ///   - session: URLSession to use. Defaults to a session with sane timeouts.
    public init(baseURL: URL = URL(string: "http://localhost:8787")!,
                sessionToken: String = "demo-session-token",
                session: URLSession = IssuerAPIClient.makeDefaultSession()) {
        self.baseURL = baseURL
        self.sessionToken = sessionToken
        self.session = session
        // JSON keys in the contract are already camelCase, so no key strategy.
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    /// A URLSession with modest timeouts appropriate for an interactive flow.
    private static func makeDefaultSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }

    // MARK: - Public API

    /// Calls `POST /v1/cards/{cardId}/eligibility`.
    ///
    /// - Parameters:
    ///   - cardId: The issuer's card identifier (path component).
    ///   - deviceId: A stable, app-generated device identifier.
    /// - Returns: The decoded `EligibilityResponse`.
    /// - Throws: `IssuerError` on transport, HTTP, or decoding failure.
    public func checkEligibility(cardId: String,
                                 deviceId: String) async throws -> EligibilityResponse {
        // Path-escape the cardId so ids with reserved characters are safe.
        let path = "/v1/cards/\(percentEncodedPathSegment(cardId))/eligibility"
        let body = EligibilityRequest(walletPlatform: "apple", deviceId: deviceId)
        let request = try makeRequest(path: path, method: "POST", jsonBody: body)
        return try await send(request, decodingTo: EligibilityResponse.self)
    }

    /// Calls `POST /v1/provisioning/apple`.
    ///
    /// This is the network round-trip performed *inside* PassKit's delegate
    /// callback. The wallet-provided certificate chain, nonce, and nonce
    /// signature arrive as raw `Data`; we Base64-encode them for the JSON body.
    ///
    /// - Parameters:
    ///   - cardId: The issuer's card identifier.
    ///   - certificates: `[leafDER, subCADER]` as raw `Data`, in PassKit's order.
    ///   - nonce: The one-time nonce `Data` from Wallet.
    ///   - nonceSignature: Wallet's signature `Data` over the nonce.
    /// - Returns: The decoded `AppleProvisioningResponse` (still Base64 inside;
    ///   call its `decoded*` accessors to obtain `Data`).
    /// - Throws: `IssuerError` on transport, HTTP, or decoding failure.
    public func requestAppleProvisioning(cardId: String,
                                         certificates: [Data],
                                         nonce: Data,
                                         nonceSignature: Data) async throws -> AppleProvisioningResponse {
        // Data -> Base64. Standard alphabet, padding included — matches the
        // strict `Data(base64Encoded:)` decoder used on the way back.
        let base64Certificates = certificates.map { $0.base64EncodedString() }
        let body = AppleProvisioningRequest(
            cardId: cardId,
            certificates: base64Certificates,
            nonce: nonce.base64EncodedString(),
            nonceSignature: nonceSignature.base64EncodedString()
        )
        let request = try makeRequest(path: "/v1/provisioning/apple",
                                      method: "POST",
                                      jsonBody: body)
        return try await send(request, decodingTo: AppleProvisioningResponse.self)
    }

    // MARK: - Request building

    /// Builds a `URLRequest` with JSON body, auth, and content headers.
    private func makeRequest<Body: Encodable>(path: String,
                                              method: String,
                                              jsonBody: Body) throws -> URLRequest {
        // Resolve the path against the base URL. Using URLComponents keeps any
        // base-URL path prefix intact and avoids double slashes.
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw IssuerError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "Authorization")
        do {
            request.httpBody = try encoder.encode(jsonBody)
        } catch {
            throw IssuerError.decoding("Failed to encode request body: \(error)")
        }
        return request
    }

    /// Percent-encodes a single path segment (e.g. a card id).
    private func percentEncodedPathSegment(_ value: String) -> String {
        // `.urlPathAllowed` still permits `/`; remove it so a segment can't span
        // path components. Fallback to the raw value if encoding somehow fails.
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    // MARK: - Transport

    /// Sends a request and decodes the JSON body into `T`, mapping every failure
    /// mode onto `IssuerError`.
    private func send<T: Decodable>(_ request: URLRequest,
                                    decodingTo type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError {
            throw IssuerError.transport(urlError.localizedDescription)
        } catch {
            throw IssuerError.transport(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw IssuerError.transport("Response was not an HTTP response.")
        }

        // Any non-2xx is an error; include a short body snippet for diagnostics.
        guard (200...299).contains(http.statusCode) else {
            let bodyText = String(data: data, encoding: .utf8)
            throw IssuerError.httpStatus(code: http.statusCode, body: bodyText)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            let snippet = String(data: data, encoding: .utf8) ?? "<non-utf8 body>"
            throw IssuerError.decoding("\(error) — body: \(snippet)")
        }
    }
}
