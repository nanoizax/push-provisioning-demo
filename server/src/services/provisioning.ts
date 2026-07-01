/**
 * provisioning.ts — Orchestrates a single push-provisioning request end to end.
 *
 * Flow per platform:
 *   1. Look up the card and confirm it is eligible.
 *   2. Ask the network TSP to tokenize the Funding PAN for this device (get a DPAN).
 *   3. Package the *token* (never the FPAN) into the platform-specific encrypted payload:
 *        - Apple  -> { activationData, encryptedPassData, ephemeralPublicKey }
 *        - Google -> Opaque Payment Card (OPC) + display metadata
 *   4. Record the attempt in the provisioning ledger so it can be tracked / advanced.
 */

import { X509Certificate, createPublicKey, type KeyObject } from "node:crypto";
import {
  buildApplePayload,
  buildOpaquePaymentCard,
  decryptApplePayload,
  generateP256KeyPair,
  type ApplePayloadOutput,
} from "../lib/crypto.ts";
import {
  tokenize,
  tapAndPayNetworkFor,
  tokenServiceProviderFor,
  type NetworkToken,
} from "./cardNetwork.ts";
import { opcContentKey, tspSigningPrivateKey } from "./keys.ts";
import { createProvisioning, type Card } from "./store.ts";

/** The sensitive object that gets encrypted into the wallet payload. Carries the token. */
function cardSecretFor(card: Card, token: NetworkToken): Record<string, unknown> {
  return {
    tokenReferenceId: token.tokenReferenceId,
    dpan: token.dpan,
    par: token.par,
    expiryMonth: token.expiryMonth,
    expiryYear: token.expiryYear,
    cardholderName: card.cardholderName,
    network: card.network,
  };
}

/**
 * Extract an EC public key from a base64 blob that is either a DER X.509 certificate
 * (the real PassKit case) or a raw DER SubjectPublicKeyInfo (convenient for demos/tests).
 */
export function publicKeyFromCertOrSpki(base64: string): KeyObject {
  const der = Buffer.from(base64, "base64");
  try {
    const cert = new X509Certificate(der);
    return cert.publicKey;
  } catch {
    return createPublicKey({ key: der, format: "der", type: "spki" });
  }
}

export interface AppleResult extends ApplePayloadOutput {
  reference: string;
  tokenReferenceId: string;
}

/**
 * Production-shaped Apple provisioning. Requires the wallet certificate chain from PassKit.
 */
export function provisionApple(args: {
  card: Card;
  deviceId: string;
  certificates: string[];
  nonce: string; // base64
}): AppleResult {
  // DEMO LIMITATION: a production issuer MUST (1) validate the full PassKit certificate
  // chain up to Apple's trusted root and (2) verify the `nonceSignature` over the `nonce`
  // before deriving any key — both are anti-replay / integrity controls. They are out of
  // scope for this offline demo (we have no real Apple chain) and are intentionally not
  // performed here. See docs/security.md ("What this demo implements vs. production").
  const leaf = args.certificates[0];
  if (!leaf) throw new HttpError(400, "certificates[0] (wallet leaf) is required");

  const walletLeafPublicKey = publicKeyFromCertOrSpki(leaf);
  const token = tokenize({
    fundingPan: args.card.fundingPan,
    deviceId: args.deviceId,
    network: args.card.network,
    expiryMonth: args.card.expiryMonth,
    expiryYear: args.card.expiryYear,
  });

  const payload = buildApplePayload({
    cardSecret: cardSecretFor(args.card, token),
    walletLeafPublicKey,
    nonce: Buffer.from(args.nonce, "base64"),
  });

  const record = createProvisioning({
    cardId: args.card.id,
    platform: "apple",
    deviceId: args.deviceId,
    tokenRef: token.tokenReferenceId,
    network: args.card.network,
  });

  return { ...payload, reference: record.reference, tokenReferenceId: token.tokenReferenceId };
}

/**
 * Demo-only Apple round-trip: no real certificate needed. The server plays *both* the
 * issuer and the wallet Secure Element — it generates a wallet key pair, builds the
 * encrypted payload, then decrypts it to prove the ECDH + AES-GCM scheme is correct.
 * The decrypted proof would NEVER be returned by a real endpoint.
 */
export function provisionAppleRoundtrip(args: { card: Card; deviceId: string; nonce: string }) {
  const wallet = generateP256KeyPair();
  const leafSpki = Buffer.from(wallet.publicKey.export({ type: "spki", format: "der" })).toString(
    "base64",
  );

  const result = provisionApple({
    card: args.card,
    deviceId: args.deviceId,
    certificates: [leafSpki],
    nonce: args.nonce,
  });

  const decryptedProof = decryptApplePayload(
    wallet.privateKey,
    {
      activationData: result.activationData,
      encryptedPassData: result.encryptedPassData,
      ephemeralPublicKey: result.ephemeralPublicKey,
    },
    Buffer.from(args.nonce, "base64"),
  );

  return { ...result, decryptedProof };
}

export interface GoogleResult {
  opc: string;
  tokenServiceProvider: NetworkToken["tokenServiceProvider"];
  network: "NETWORK_VISA" | "NETWORK_MASTERCARD";
  displayName: string;
  lastDigits: string;
  reference: string;
  tokenReferenceId: string;
}

/** Google push provisioning — mint an Opaque Payment Card carrying the network token. */
export function provisionGoogle(args: {
  card: Card;
  deviceId: string;
  walletAccountId: string;
}): GoogleResult {
  const token = tokenize({
    fundingPan: args.card.fundingPan,
    deviceId: args.deviceId,
    network: args.card.network,
    expiryMonth: args.card.expiryMonth,
    expiryYear: args.card.expiryYear,
  });

  const opc = buildOpaquePaymentCard({
    cardSecret: {
      ...cardSecretFor(args.card, token),
      walletAccountId: args.walletAccountId,
    },
    tspSigningKey: tspSigningPrivateKey(),
    contentKey: opcContentKey(),
  });

  const record = createProvisioning({
    cardId: args.card.id,
    platform: "google",
    deviceId: args.deviceId,
    tokenRef: token.tokenReferenceId,
    network: args.card.network,
  });

  return {
    opc,
    tokenServiceProvider: tokenServiceProviderFor(args.card.network),
    network: tapAndPayNetworkFor(args.card.network),
    displayName: args.card.displayName,
    lastDigits: args.card.last4,
    reference: record.reference,
    tokenReferenceId: token.tokenReferenceId,
  };
}

/** Small typed error carrying an HTTP status, thrown by services and mapped by the router. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}
