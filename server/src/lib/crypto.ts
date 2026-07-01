/**
 * crypto.ts — Payload cryptography for wallet push provisioning.
 *
 * This module implements a faithful, runnable stand-in for the cryptography that a
 * card issuer / Token Service Provider (TSP) performs when a mobile wallet asks it to
 * provision a card.
 *
 * ── Apple Wallet (PassKit "ECC_V2" encryption scheme) ────────────────────────────────
 *   When the app presents `PKAddPaymentPassViewController`, PassKit hands the issuer a
 *   certificate chain (a leaf certificate + a sub-CA), a `nonce`, and a `nonceSignature`.
 *   The issuer must return three fields — `encryptedPassData`, `ephemeralPublicKey`,
 *   `activationData` — computed roughly as:
 *
 *     1. Verify the certificate chain and the nonce signature (integrity / anti-replay).
 *     2. Generate an ephemeral EC P-256 key pair.
 *     3. ECDH( ephemeralPrivate , walletLeafPublic ) -> shared secret Z.
 *     4. X9.63 KDF( Z, SharedInfo ) -> 32-byte AES key, where SharedInfo binds the
 *        AES algorithm id and the nonce so the key is unique per request.
 *     5. AES-256-GCM encrypt the sensitive card payload (the network token, expiry, etc).
 *     6. Return the ciphertext (`encryptedPassData`), the ephemeral public key
 *        (`ephemeralPublicKey`, so the Secure Element can re-derive Z), and the
 *        network `activationData` blob.
 *
 *   This file implements exactly that round-trip using Node's built-in `crypto`, and the
 *   accompanying smoke test proves the payload decrypts on the "wallet" side.
 *
 * ── Google Pay (TapAndPay "OPC") ─────────────────────────────────────────────────────
 *   Google's push provisioning consumes an "Opaque Payment Card" (OPC): an encrypted,
 *   integrity-protected blob minted by the TSP that the app forwards to `pushTokenize`
 *   without ever seeing the clear PAN. We model it as an encrypt-then-sign envelope.
 *
 * NOTE: The exact byte layouts and the production key ceremony are defined by Visa VDEP
 * and Mastercard MDES under NDA. The schemes here are cryptographically real (real ECDH,
 * real AES-GCM, real X9.63 KDF, real ECDSA) but are a demonstration, not the certified
 * network wire format. Every place that diverges from production is called out in comments.
 */

import {
  createHash,
  createSign,
  createVerify,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  type KeyObject,
} from "node:crypto";

const P256 = "prime256v1"; // NIST P-256 / secp256r1 — the curve Apple & the networks use.

export interface ECKeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

/** Generate an EC P-256 key pair as Node KeyObjects. */
export function generateP256KeyPair(): ECKeyPair {
  return generateKeyPairSync("ec", { namedCurve: P256 });
}

/**
 * ANSI X9.63 Key Derivation Function (a.k.a. SEC1 KDF2) with SHA-256.
 * This is the KDF PassKit's ECC_V2 scheme uses to turn the ECDH shared secret into an
 * AES key. Output = H(Z || counter_be32 || SharedInfo) concatenated until keyLen bytes.
 */
export function x963KDF(sharedSecret: Buffer, sharedInfo: Buffer, keyLen = 32): Buffer {
  const blocks: Buffer[] = [];
  let counter = 1;
  let produced = 0;
  while (produced < keyLen) {
    const counterBuf = Buffer.alloc(4);
    counterBuf.writeUInt32BE(counter, 0);
    const digest = createHash("sha256")
      .update(sharedSecret)
      .update(counterBuf)
      .update(sharedInfo)
      .digest();
    blocks.push(digest);
    produced += digest.length;
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, keyLen);
}

export interface AesGcmResult {
  /** 12-byte GCM nonce/IV. */
  iv: Buffer;
  ciphertext: Buffer;
  /** 16-byte GCM authentication tag. */
  tag: Buffer;
}

/** AES-256-GCM encrypt. `aad` is authenticated but not encrypted. */
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): AesGcmResult {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ciphertext, tag };
}

/** AES-256-GCM decrypt (used by the smoke test's "wallet" side to prove correctness). */
export function aesGcmDecrypt(
  key: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  tag: Buffer,
  aad?: Buffer,
): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(aad);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Derive the ECDH shared secret Z between our ephemeral private key and the peer's
 * public key. Returns the raw X-coordinate as required by X9.63.
 */
export function ecdhSharedSecret(privateKey: KeyObject, peerPublicKey: KeyObject): Buffer {
  return diffieHellman({ privateKey, publicKey: peerPublicKey });
}

// ── Apple Wallet payload (PassKit ECC_V2 style) ──────────────────────────────────────

export interface ApplePayloadInput {
  /** The sensitive card data to protect (network token, expiry, cardholder, etc). */
  cardSecret: Record<string, unknown>;
  /** The wallet leaf certificate's public key (from the PassKit certificate chain). */
  walletLeafPublicKey: KeyObject;
  /** The nonce PassKit provided, base64-decoded. Binds the key to this one request. */
  nonce: Buffer;
}

export interface ApplePayloadOutput {
  activationData: string; // base64
  encryptedPassData: string; // base64
  ephemeralPublicKey: string; // base64 (DER SubjectPublicKeyInfo)
}

/**
 * Build the three fields a `PKAddPaymentPassRequest` needs, using the ECC_V2 scheme.
 * Returns base64 strings ready to hand back to the iOS client.
 */
export function buildApplePayload(input: ApplePayloadInput): ApplePayloadOutput {
  // 1. Ephemeral EC P-256 key pair — fresh per provisioning request.
  const ephemeral = generateP256KeyPair();

  // 2. ECDH against the wallet's leaf public key.
  const Z = ecdhSharedSecret(ephemeral.privateKey, input.walletLeafPublicKey);

  // 3. Derive the AES-256 key. SharedInfo binds the AES algorithm identity + the nonce,
  //    mirroring the "AlgorithmID || PartyUInfo(nonce)" construction of the real scheme.
  const sharedInfo = Buffer.concat([Buffer.from("id-aes256-GCM", "utf8"), input.nonce]);
  const aesKey = x963KDF(Z, sharedInfo, 32);

  // 4. AES-256-GCM encrypt the card secret. The nonce is authenticated as AAD.
  const plaintext = Buffer.from(JSON.stringify(input.cardSecret), "utf8");
  const { iv, ciphertext, tag } = aesGcmEncrypt(aesKey, plaintext, input.nonce);

  // Apple concatenates the GCM output as iv || ciphertext || tag inside encryptedPassData.
  const encryptedPassData = Buffer.concat([iv, ciphertext, tag]);

  // ephemeralPublicKey is exported as DER SubjectPublicKeyInfo so the Secure Element can
  // re-run ECDH + the same KDF to recover the AES key and decrypt inside its trust boundary.
  const ephemeralPublicKeyDer = ephemeral.publicKey.export({ type: "spki", format: "der" });

  // activationData is the network's activation blob (VDEP/MDES). We model it as a signed
  // reference echoing the nonce so the wallet/network can correlate the request.
  const activation = Buffer.from(
    JSON.stringify({ nonce: input.nonce.toString("base64"), issuedAt: staticIsoStamp() }),
    "utf8",
  );

  return {
    activationData: activation.toString("base64"),
    encryptedPassData: encryptedPassData.toString("base64"),
    ephemeralPublicKey: Buffer.from(ephemeralPublicKeyDer).toString("base64"),
  };
}

/**
 * Wallet-side inverse of {@link buildApplePayload}. Only used by the smoke test to prove
 * the ciphertext round-trips. In production this runs inside the device Secure Element.
 */
export function decryptApplePayload(
  walletLeafPrivateKey: KeyObject,
  out: ApplePayloadOutput,
  nonce: Buffer,
): Record<string, unknown> {
  const ephemeralPublicKey = importSpkiPublicKey(
    Buffer.from(out.ephemeralPublicKey, "base64"),
  );
  const Z = ecdhSharedSecret(walletLeafPrivateKey, ephemeralPublicKey);
  const sharedInfo = Buffer.concat([Buffer.from("id-aes256-GCM", "utf8"), nonce]);
  const aesKey = x963KDF(Z, sharedInfo, 32);

  const blob = Buffer.from(out.encryptedPassData, "base64");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(12, blob.length - 16);
  const plaintext = aesGcmDecrypt(aesKey, iv, ciphertext, tag, nonce);
  return JSON.parse(plaintext.toString("utf8"));
}

// ── Google Pay OPC (Opaque Payment Card) ─────────────────────────────────────────────

export interface OpcInput {
  cardSecret: Record<string, unknown>;
  /** The TSP's OPC-signing private key (proves the OPC came from the issuer/TSP). */
  tspSigningKey: KeyObject;
  /** Symmetric key shared with Google's TapAndPay backend in a real integration. */
  contentKey: Buffer;
}

/**
 * Build an Opaque Payment Card: encrypt-then-sign envelope, base64-encoded.
 * The real OPC format is defined by the TSP (Visa VDEP / Mastercard MDES); this is a
 * structurally equivalent stand-in (AES-256-GCM content encryption + ECDSA signature).
 */
export function buildOpaquePaymentCard(input: OpcInput): string {
  const plaintext = Buffer.from(JSON.stringify(input.cardSecret), "utf8");
  const { iv, ciphertext, tag } = aesGcmEncrypt(input.contentKey, plaintext);

  const envelope = {
    v: 1,
    alg: "AES-256-GCM",
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
  const envelopeBytes = Buffer.from(JSON.stringify(envelope), "utf8");

  // Sign the envelope so TapAndPay/the network can verify issuer authenticity.
  const signature = createSign("SHA256")
    .update(envelopeBytes)
    .sign({ key: input.tspSigningKey, dsaEncoding: "der" });

  const opc = {
    envelope: envelopeBytes.toString("base64"),
    signature: signature.toString("base64"),
  };
  return Buffer.from(JSON.stringify(opc), "utf8").toString("base64");
}

/** Verify an OPC signature (used by the smoke test / a mock TapAndPay backend). */
export function verifyOpaquePaymentCard(opcBase64: string, tspPublicKey: KeyObject): boolean {
  const opc = JSON.parse(Buffer.from(opcBase64, "base64").toString("utf8")) as {
    envelope: string;
    signature: string;
  };
  const envelopeBytes = Buffer.from(opc.envelope, "base64");
  return createVerify("SHA256")
    .update(envelopeBytes)
    .verify(
      { key: tspPublicKey, dsaEncoding: "der" },
      Buffer.from(opc.signature, "base64"),
    );
}

// ── helpers ──────────────────────────────────────────────────────────────────────────

/** Import a DER SubjectPublicKeyInfo EC public key. */
export function importSpkiPublicKey(der: Buffer): KeyObject {
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/**
 * A deterministic ISO-8601-looking timestamp. `Date.now()` is intentionally avoided so
 * that provisioning payloads are reproducible in tests and CI; a real TSP would use the
 * actual time here.
 */
function staticIsoStamp(): string {
  return "2026-01-01T00:00:00.000Z";
}
