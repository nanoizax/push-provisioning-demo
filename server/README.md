# Issuer / TSP provisioning server

A dependency-free mock of the **card issuer + Token Service Provider (TSP)** backend that
mobile wallets talk to during push provisioning. It implements the cryptography and the
API surface that a real Apple Wallet / Google Pay integration requires.

> Framework-free **by design**: it runs on a bare Node ≥ 22.6 with **no `npm install`**, so
> a reviewer can clone and run it in one command. The route handlers are written so they
> drop straight into Express/Fastify for production.

## Run it

```bash
cd server
npm start            # node --experimental-strip-types src/index.ts
# -> http://localhost:8787   (health: /health)
```

Verify the whole flow, including that the encrypted payload actually decrypts:

```bash
npm run smoke
#   ✅  apple encryptedPassData DECRYPTS to the network token
#   ✅  clear funding PAN is NOT present anywhere in the apple payload
#   ✅  google OPC signature verifies against the TSP key
#   ... all checks passed (0 failed)
```

Optional type-check (needs `npm install` for the TypeScript compiler only):

```bash
npm install && npm run typecheck
```

## What it models

| Concern | File | Notes |
| --- | --- | --- |
| Payload cryptography | [`src/lib/crypto.ts`](src/lib/crypto.ts) | ECDH P-256 + **X9.63 KDF** + AES-256-GCM (Apple ECC_V2); encrypt-then-sign OPC (Google) |
| Network tokenization | [`src/services/cardNetwork.ts`](src/services/cardNetwork.ts) | Mock Visa **VDEP** / Mastercard **MDES** — FPAN → DPAN, token ref, PAR |
| Issuer state | [`src/services/store.ts`](src/services/store.ts) | Card portfolio + provisioning ledger |
| Orchestration | [`src/services/provisioning.ts`](src/services/provisioning.ts) | Ties eligibility → tokenize → encrypt → record |
| HTTP API | [`src/routes.ts`](src/routes.ts) | The endpoints below |

## API

All routes except `/health` require `Authorization: Bearer demo-session-token`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/v1/cards` | List demo cards (display metadata only) |
| `POST` | `/v1/cards/:cardId/eligibility` | Is the card provisionable on this wallet/device? |
| `POST` | `/v1/provisioning/apple` | PassKit ECC_V2 payload (needs the wallet certificate chain) |
| `POST` | `/v1/provisioning/apple/roundtrip` | **Demo-only**: same payload **plus a decrypted proof** |
| `POST` | `/v1/provisioning/google/opc` | Opaque Payment Card for `TapAndPay.pushTokenize` |
| `GET` | `/v1/provisioning/:reference/status` | Provisioning lifecycle state |
| `POST` | `/v1/webhooks/network` | Simulate a network token-status callback |

### Example — Apple round-trip

```bash
curl -s -X POST http://localhost:8787/v1/provisioning/apple/roundtrip \
  -H 'Authorization: Bearer demo-session-token' -H 'Content-Type: application/json' \
  -d '{"cardId":"card_demo_visa_4242"}' | head -c 600
```

Returns `activationData`, `encryptedPassData`, `ephemeralPublicKey` (the exact three fields
a `PKAddPaymentPassRequest` needs) and — because this is the demo endpoint — a
`decryptedProof` object showing the ciphertext really contains the network token.

### Example — Google OPC

```bash
curl -s -X POST http://localhost:8787/v1/provisioning/google/opc \
  -H 'Authorization: Bearer demo-session-token' -H 'Content-Type: application/json' \
  -d '{"cardId":"card_demo_mc_5100","deviceId":"dev-1","walletAccountId":"wa-1"}'
```

## The cryptography, precisely

**Apple (PassKit `ECC_V2`)** — for each request the server:

1. Generates an ephemeral EC **P-256** key pair.
2. Runs **ECDH** against the wallet leaf public key from the PassKit certificate chain.
3. Derives a 32-byte AES key with the **ANSI X9.63 KDF** (SHA-256), binding the PassKit
   `nonce` into `SharedInfo` so the key is unique per request.
4. **AES-256-GCM** encrypts the *network token* (never the funding PAN).
5. Returns `encryptedPassData = iv‖ciphertext‖tag`, the ephemeral public key, and the
   network `activationData`.

The Secure Element re-derives the same key from the ephemeral public key and decrypts
inside its trust boundary — modelled exactly by `decryptApplePayload()` in the smoke test.

**Google (`OPC`)** — the server produces an Opaque Payment Card: an AES-256-GCM
encrypt-then-**ECDSA-sign** envelope carrying the token, which the app forwards to
`pushTokenize` without ever seeing the clear PAN.

## Honesty box — what's real vs mocked

- **Real:** ECDH, X9.63 KDF, AES-256-GCM, ECDSA signatures, the request/response shapes,
  auth, eligibility, and lifecycle — all runnable and tested.
- **Mocked / illustrative:** the exact certified wire formats of Visa VDEP & Mastercard
  MDES and Apple's precise `SharedInfo`/`activationData` byte layout are defined under NDA;
  the schemes here are structurally faithful stand-ins. Swap in the certified SDK/spec at
  the boundaries marked in `crypto.ts`. The in-memory store and static session token would
  become a database, an HSM/KMS, and short-lived SCA tokens in production.
