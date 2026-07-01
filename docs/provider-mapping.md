**English** · [Español](provider-mapping.es.md) · [Português](provider-mapping.pt.md)

# Provider mapping

This demo is deliberately **provider-agnostic**: the issuer/TSP boundary is a clean seam, so
the same app code and the same backend shape drop onto whichever tokenization provider the
company already uses. Here is how the concepts map to the real programs and platforms.

## Card networks (Token Service Providers)

| Concept in this repo | Visa | Mastercard |
| --- | --- | --- |
| Push provisioning program | **VDEP** (Visa Digital Enablement Program) | **MDES** (Mastercard Digital Enablement Service) |
| Device token | Visa Token (DPAN) | MDES token (DPAN) |
| Account reference | PAR (Payment Account Reference) | PAR |
| Enablement API | VTS (Visa Token Service) | MDES for Merchants / Issuers |
| TapAndPay TSP constant | `TOKEN_PROVIDER_VISA` | `TOKEN_PROVIDER_MASTERCARD` |

## Processors / issuer-platforms (who you actually integrate)

Most fintechs don't talk to the network directly — they go through a processor / BIN sponsor
that wraps VDEP/MDES. The `/server` boundary maps onto any of them:

| Platform | How push provisioning is exposed | Where it slots in |
| --- | --- | --- |
| **Marqeta** | Digital Wallet Token APIs; `pushTokenize`/PassKit payload provisioning | Replace `cardNetwork.ts` + payload build with Marqeta SDK calls |
| **Stripe Issuing** | `ephemeral_keys` + push provisioning helpers in the iOS/Android SDKs | The SDK returns the wallet payload; the app wiring here is unchanged |
| **Galileo / i2c / Thredd (Tribe)** | Processor push-provisioning endpoints over VDEP/MDES | Same seam: issuer backend returns the encrypted payload / OPC |
| **Apple Pay In-App Provisioning (direct)** | PassKit + your own TSP relationship | Exactly the `/provisioning/apple` shape in this repo |

## What stays the same regardless of provider

- The **iOS** code path: `PKAddPaymentPassViewController` → delegate certificates/nonce →
  issuer call → `PKAddPaymentPassRequest`.
- The **Android** code path: `TapAndPay` eligibility → OPC from issuer → `pushTokenize` →
  activity result → `DataChangedListener`.
- The **app never sees the PAN**; it forwards opaque payloads.

## What changes per provider

- The exact bytes of `encryptedPassData` / `activationData` (Apple) and the `OPC` (Google),
  which the provider's SDK or certified service produces.
- Certificate management, key ceremony, and the ID&V / step-up configuration.

> The point of this structure: swapping Marqeta for Stripe Issuing for a direct VDEP
> integration touches only the marked boundaries in [`server/src/lib/crypto.ts`](../server/src/lib/crypto.ts)
> and [`server/src/services/cardNetwork.ts`](../server/src/services/cardNetwork.ts) — never the app code.
