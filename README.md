<div align="center">

# WalletPush — Card Push Provisioning

**Add a payment card to Apple Wallet & Google Pay directly from the issuer app — one tap, no typing.**

A production-shaped reference implementation of *push provisioning* across **iOS (PassKit)**,
**Android (Google Pay TapAndPay)**, and the **issuer / Token Service Provider backend** that
ties them together — with an interactive demo you can run in a browser.

`PassKit ECC_V2` · `TapAndPay OPC` · `ECDH P-256` · `X9.63 KDF` · `AES-256-GCM` · `Visa VDEP / Mastercard MDES`

</div>

---

## What is push provisioning?

When a cardholder taps **“Add to Apple Wallet”** or **“Add to Google Pay”** *inside their bank
app*, the card lands in the OS wallet without anyone typing a card number. The issuer — already
authenticating the user — vouches for the card, and the card network issues a device **token**
so the real PAN never touches the phone.

That single tap is a surprisingly deep integration: a PassKit / TapAndPay handshake on the
device, a tokenization call to Visa VDEP or Mastercard MDES, and a per-request cryptographic
envelope built on the issuer's servers. **This repo implements all three, end to end.**

## Three pillars

| Pillar | Path | What it demonstrates |
| --- | --- | --- |
| 🍎 **iOS SDK module** | [`/ios`](ios) | `PKAddPaymentPassViewController` + full delegate handshake, eligibility via `PKPassLibrary`, `ECC_V2` request assembly, SwiftUI `Add to Wallet` button |
| 🤖 **Android SDK module** | [`/android`](android) | Google Pay `TapAndPay` — `isTokenized`, `pushTokenize(OPC)`, activity-result handling, `DataChangedListener` lifecycle, Compose button |
| 🏦 **Issuer / TSP backend** | [`/server`](server) | Eligibility, network tokenization (VDEP/MDES), and the real crypto: ECDH → X9.63 KDF → AES-256-GCM (Apple) and signed OPC (Google) |
| 🎬 **Interactive demo** | [`/web-demo`](web-demo) | Offline-capable visualization of both flows — phone mockup, animated sequence, live payload inspector |

Deep dives: [architecture](docs/architecture.md) · [sequence diagrams](docs/sequence-diagrams.md) ·
[security model](docs/security.md) · [provider mapping](docs/provider-mapping.md).

## Quickstart

**See it (no install, works offline):**

```bash
# just open the file in a browser
open web-demo/index.html          # macOS
start web-demo/index.html         # Windows
```

**Run the issuer backend + verify the cryptography (Node ≥ 22.6, zero dependencies):**

```bash
cd server
npm start          # -> http://localhost:8787
npm run smoke      # end-to-end test — proves the encrypted payload decrypts
```

```
✅  apple payload has all three PassKit fields
✅  apple encryptedPassData DECRYPTS to the network token
✅  clear funding PAN is NOT present in the payload proof
✅  google returns an OPC + mastercard TSP
✅  webhook advances state to active
11 passed, 0 failed
```

Then flip the web demo to **“Live API”** to watch it drive the real backend.

## How it works (30-second version)

```
 Issuer App  ──►  Issuer/TSP backend  ──►  Card Network (VDEP/MDES)
     │                    │  tokenize FPAN → DPAN + PAR
     │                    ▼
     │            encrypt token  (Apple: ECDH+KDF+AES-GCM · Google: signed OPC)
     ▼                    │
 OS Wallet  ◄─────────────┘   Secure Element decrypts · token provisioned · PAN never on device
```

The **app never sees the clear PAN** — it only forwards an encrypted, network-tokenized payload
from the issuer to the OS wallet. Full message flow in
[sequence diagrams](docs/sequence-diagrams.md).

## Security highlights

- **Real cryptography, tested:** ECDH P-256, ANSI X9.63 KDF, AES-256-GCM, ECDSA — the smoke
  test decrypts the Apple payload to prove correctness ([`server/src/lib/crypto.ts`](server/src/lib/crypto.ts)).
- **Per-request ephemeral keys**, with the PassKit nonce bound into the KDF to defeat replay.
- **PAN isolation:** only a device token (DPAN) is ever provisioned; the funding PAN stays
  inside the issuer boundary.
- Honest [threat model + demo-vs-production table](docs/security.md), including the Apple
  entitlement and Google allowlisting gates that are commercial approvals, not code.

## Provider-agnostic by design

The issuer/TSP boundary is a clean seam, so the same app code and backend shape drop onto
**Marqeta, Stripe Issuing, Galileo, Thredd**, or a direct **Visa VDEP / Mastercard MDES**
integration — only the marked boundaries change. See [provider mapping](docs/provider-mapping.md).

## Tech

| Layer | Stack |
| --- | --- |
| iOS | Swift 5.9+, PassKit, async/await, SwiftUI, SwiftPM |
| Android | Kotlin 2.0, Google Play Services `TapAndPay`, Coroutines, Jetpack Compose, Retrofit |
| Backend | TypeScript on Node ≥ 22.6, `node:crypto`, `node:http` — zero runtime dependencies |
| Demo | Single self-contained HTML/CSS/JS file, no build |

## Repository layout

```
push-provisioning-demo/
├── ios/         Swift SDK module + sample screen + README
├── android/     Kotlin :pushprovisioning library + :app sample + README
├── server/      Issuer + TSP backend (crypto, tokenization, REST) + smoke test
├── web-demo/    Interactive visualization (index.html)
├── docs/        Architecture, sequence diagrams, security, provider mapping
└── .github/     CI (runs the backend smoke test)
```

## Status & scope

This is a **reference implementation and demo**, engineered to be correct where it counts (the
crypto and the platform handshakes are real) and honest where a real deployment needs
commercial onboarding (Apple entitlement, Google allowlisting, certified TSP wire formats,
HSM/KMS, PCI scope). Each boundary is marked in code and documented in
[security.md](docs/security.md).

## Author

**Leandro Perez** — full-stack engineer, [SonhoLab](https://sonholab.com) ·
contacto@sonholab.com · GitHub [@nanoizax](https://github.com/nanoizax)

## License

[MIT](LICENSE) © Leandro Perez
