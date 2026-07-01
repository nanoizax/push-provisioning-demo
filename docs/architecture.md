**English** · [Español](architecture.es.md) · [Português](architecture.pt.md)

# Architecture

## The actors

| Actor | Role |
| --- | --- |
| **Issuer app** (iOS / Android) | The bank/fintech app the cardholder already trusts. It initiates provisioning and shuttles opaque payloads — it never handles the clear PAN. |
| **Issuer / TSP backend** | Confirms eligibility, requests a network token, and produces the platform-specific encrypted payload. Modelled by [`/server`](../server). |
| **Card network** (Visa **VDEP** / Mastercard **MDES**) | The Token Service Provider. Turns a Funding PAN (FPAN) into a device token (DPAN) + PAR and runs the ID&V risk decision. |
| **OS wallet** (Apple Wallet / Google Pay) | Presents the system add-card UI and installs the token into the device Secure Element. |

## Why "push" provisioning

- **Pull / manual provisioning:** the user opens the wallet app and types the card number.
  High friction, high fraud (anyone with the PAN can add it), poor conversion.
- **Push provisioning:** the user taps **“Add to Apple Wallet / Google Pay”** *inside the
  issuer app*, already authenticated. One tap, no typing, and the issuer — not the typist —
  vouches for the card. This is the flow banks and neobanks ask for.

## Repository layout

```
push-provisioning-demo/
├── ios/         Swift SDK module — PassKit PKAddPaymentPassViewController + delegate
├── android/     Kotlin SDK module — Google Pay TapAndPay pushTokenize
├── server/      Issuer + TSP backend — ECDH/AES-GCM crypto, tokenization, REST API
├── web-demo/    Interactive, offline-capable visualization of both flows
└── docs/        This documentation set
```

## Data-flow invariants

1. **The clear PAN never reaches the device.** The app only ever holds an encrypted payload
   (Apple) or an opaque blob (Google) that carries a *token*, not the funding number.
2. **Keys are ephemeral and request-bound.** Apple's `ECC_V2` derives a fresh AES key per
   request from an ephemeral EC key pair + the PassKit nonce; the key exists only long
   enough to encrypt one payload.
3. **Decryption happens in the Secure Element.** Only the device's secure hardware can
   re-derive the key and open the payload — the app process cannot.
4. **The issuer is the source of truth.** Eligibility, tokenization, and lifecycle all pass
   through the issuer/TSP, which is where risk (ID&V), step-up auth, and audit live.

## How the pieces line up with the code

| Concept | iOS | Android | Backend |
| --- | --- | --- | --- |
| Eligibility | `WalletProvisioningManager.canAddCard` + `/eligibility` | `PushProvisioningManager.isCardTokenized` + `/eligibility` | `POST /v1/cards/:id/eligibility` |
| Hand-off to OS | `PKAddPaymentPassViewController` | `TapAndPay.pushTokenize` | — |
| Encrypted payload | delegate → `/provisioning/apple` | `/provisioning/google/opc` | `crypto.ts` (`buildApplePayload` / `buildOpaquePaymentCard`) |
| Tokenization | — | — | `cardNetwork.ts` (`tokenize`) |
| Lifecycle | `didFinishAdding` | `handleActivityResult` + `DataChangedListener` | `/provisioning/:ref/status`, `/webhooks/network` |

See [sequence-diagrams.md](sequence-diagrams.md) for the full message flow and
[security.md](security.md) for the threat model.
