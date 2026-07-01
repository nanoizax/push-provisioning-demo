# Security model

Push provisioning is a payments-grade flow. This document states the threat model, the
guarantees, and — honestly — what this demo implements versus what a production integration
adds.

## Guarantees the design provides

| Guarantee | How |
| --- | --- |
| Clear PAN never reaches the device | Only a **network token (DPAN)** is provisioned; it is encrypted before it leaves the issuer. |
| Payload confidentiality | **AES-256-GCM** content encryption. Apple: key from ephemeral **ECDH P-256** + **X9.63 KDF**. Google: content key + **ECDSA**-signed OPC. |
| Per-request key freshness | Apple `ECC_V2` generates a new ephemeral EC key pair per request; the PassKit **nonce** is bound into the KDF `SharedInfo`, defeating replay. |
| Payload integrity / authenticity | GCM auth tag on the ciphertext; ECDSA signature over the Google OPC envelope. |
| Decryption confined to secure hardware | Only the device **Secure Element** can re-derive the key and open the payload. |
| Caller authentication | Bearer token on every issuer call (production: short-lived, minted after SCA). |
| Eligibility & risk gating | Issuer decides eligibility; the network runs **ID&V** before activation. |

## Threats and mitigations

- **Stolen PAN added to an attacker's wallet** → push provisioning removes manual entry; the
  issuer (not a typist) authorizes, and the network's ID&V step-up (e.g. OTP) gates activation.
- **Replay of a captured payload** → nonce-bound, single-use ephemeral keys; the payload only
  decrypts inside the Secure Element that participated in the handshake.
- **MITM on the wire** → TLS in transit *plus* application-layer AES-GCM; a network observer
  sees ciphertext, never the token.
- **Compromised app process** → the app never holds key material or the clear token; it moves
  opaque blobs only.
- **Token lifecycle abuse** (lost device, suspended card) → network webhooks drive
  suspend/resume/delete; the issuer ledger is the audit trail.

## What this demo implements vs. production

| Area | This demo | Production |
| --- | --- | --- |
| ECDH / KDF / AES-GCM / ECDSA | ✅ real, runnable, tested | Same primitives, certified network wire format |
| Certificate-chain & nonce-signature **verification** | Parsed; verification is stubbed for the offline demo | Full X.509 chain validation + signature check |
| Key storage | In-memory, generated at boot | **HSM / KMS**, rotation, dual control |
| Session token | Static env value | Short-lived, SCA-bound, per-session |
| Data store | In-memory maps | Database + immutable audit log |
| Network tokenization | Deterministic mock (VDEP/MDES shaped) | Certified Visa VDEP / Mastercard MDES / processor SDK |
| PAN handling | Fake PANs only | PCI-DSS scope, tokenized at rest, never logged |

## Entitlements & allowlisting (not code — approvals)

- **iOS:** the `com.apple.developer.payment-pass-provisioning` entitlement is granted by
  Apple only to approved issuers/partners; In-App Provisioning also requires network
  enablement. Works on a real device with an eligible Apple ID (not the simulator).
- **Android:** `TapAndPay` is an **allowlisted** API. You must be an approved issuer and
  register your package name + signing SHA-256 with Google; calls error until allowlisted.

These are commercial/onboarding gates, not something code can bypass — and a candidate who
knows that up front is exactly what an issuer-integration team wants to hear.
