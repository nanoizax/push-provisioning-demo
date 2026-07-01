/**
 * routes.ts — The issuer / TSP HTTP API surface consumed by the iOS & Android apps
 * and by the browser demo.
 *
 *   GET  /health
 *   GET  /v1/cards                                 list demo cards (for the web demo)
 *   POST /v1/cards/:cardId/eligibility             is this card provisionable on this wallet?
 *   POST /v1/provisioning/apple                    PassKit ECC_V2 payload (needs wallet certs)
 *   POST /v1/provisioning/apple/roundtrip          demo-only: payload + decrypted proof
 *   POST /v1/provisioning/google/opc               Opaque Payment Card for TapAndPay
 *   GET  /v1/provisioning/:reference/status        provisioning lifecycle state
 *   POST /v1/webhooks/network                      simulate a network token status callback
 */

import { requireBearer } from "./lib/auth.ts";
import { Router } from "./lib/http.ts";
import {
  HttpError,
  provisionApple,
  provisionAppleRoundtrip,
  provisionGoogle,
} from "./services/provisioning.ts";
import { advanceProvisioning, getCard, getProvisioning, listCards } from "./services/store.ts";
import type { ProvisioningState } from "./services/store.ts";

function asString(obj: unknown, key: string, required = true): string {
  const val = (obj as Record<string, unknown> | undefined)?.[key];
  if (typeof val === "string" && val.length > 0) return val;
  if (required) throw new HttpError(400, `missing_or_invalid_field:${key}`);
  return "";
}

function asStringArray(obj: unknown, key: string): string[] {
  const val = (obj as Record<string, unknown> | undefined)?.[key];
  if (Array.isArray(val) && val.every((v) => typeof v === "string")) return val as string[];
  throw new HttpError(400, `missing_or_invalid_field:${key}`);
}

export function buildRouter(): Router {
  const router = new Router();

  router.get("/health", () => ({
    status: 200,
    body: { status: "ok", service: "issuer-provisioning-server", version: "1.0.0" },
  }));

  // Portfolio for the browser demo (no secrets — display metadata only).
  router.get("/v1/cards", ({ req }) => {
    requireBearer(req);
    return {
      status: 200,
      body: {
        cards: listCards().map((c) => ({
          id: c.id,
          displayName: c.displayName,
          last4: c.last4,
          network: c.network,
          cardholderName: c.cardholderName,
          provisioningEnabled: c.provisioningEnabled,
        })),
      },
    };
  });

  // Eligibility — can this card be pushed to the requested wallet on this device?
  router.post("/v1/cards/:cardId/eligibility", ({ req, params, body }) => {
    requireBearer(req);
    const card = getCard(params.cardId!);
    const platform = asString(body, "walletPlatform"); // "apple" | "google"
    asString(body, "deviceId");

    if (!card) {
      return { status: 200, body: { eligible: false, reason: "card_not_found" } };
    }
    if (!card.provisioningEnabled) {
      return { status: 200, body: { eligible: false, reason: "card_not_eligible", network: card.network } };
    }
    const base = {
      eligible: true as const,
      network: card.network,
      cardholderName: card.cardholderName,
      reason: null,
    };
    // Apple wants suffix + a localized description + an account identifier; Google wants last4.
    if (platform === "apple") {
      return {
        status: 200,
        body: {
          ...base,
          primaryAccountSuffix: card.last4,
          localizedDescription: card.displayName,
          primaryAccountIdentifier: "",
        },
      };
    }
    return { status: 200, body: { ...base, last4: card.last4, displayName: card.displayName } };
  });

  // Apple push provisioning — production-shaped (expects PassKit certificate chain).
  router.post("/v1/provisioning/apple", ({ req, body }) => {
    requireBearer(req);
    const card = requireCard(asString(body, "cardId"));
    const result = provisionApple({
      card,
      deviceId: asString(body, "deviceId", false) || "apple-device",
      certificates: asStringArray(body, "certificates"),
      nonce: asString(body, "nonce"),
    });
    return {
      status: 200,
      body: {
        activationData: result.activationData,
        encryptedPassData: result.encryptedPassData,
        ephemeralPublicKey: result.ephemeralPublicKey,
        reference: result.reference,
      },
    };
  });

  // Apple demo round-trip — proves the crypto works without a real device/certificate.
  router.post("/v1/provisioning/apple/roundtrip", ({ req, body }) => {
    requireBearer(req);
    const card = requireCard(asString(body, "cardId"));
    const nonce = asString(body, "nonce", false) || Buffer.from("demo-nonce-000000").toString("base64");
    const result = provisionAppleRoundtrip({ card, deviceId: "apple-demo-device", nonce });
    return { status: 200, body: result };
  });

  // Google push provisioning — mint an Opaque Payment Card.
  router.post("/v1/provisioning/google/opc", ({ req, body }) => {
    requireBearer(req);
    const card = requireCard(asString(body, "cardId"));
    const result = provisionGoogle({
      card,
      deviceId: asString(body, "deviceId", false) || "android-device",
      walletAccountId: asString(body, "walletAccountId", false) || "wallet-account",
    });
    return { status: 200, body: result };
  });

  // Provisioning lifecycle state (the app polls this after handing off to the wallet).
  router.get("/v1/provisioning/:reference/status", ({ req, params }) => {
    requireBearer(req);
    const record = getProvisioning(params.reference!);
    if (!record) throw new HttpError(404, "provisioning_not_found");
    return {
      status: 200,
      body: {
        reference: record.reference,
        state: record.state,
        network: record.network,
        tokenRef: record.tokenRef,
        history: record.history,
      },
    };
  });

  // Simulate a network (VDEP/MDES) token-status webhook advancing the lifecycle.
  router.post("/v1/webhooks/network", ({ req, body }) => {
    requireBearer(req);
    const reference = asString(body, "reference");
    const state = asString(body, "state") as ProvisioningState;
    const allowed: ProvisioningState[] = ["requested", "provisioned", "active", "failed"];
    if (!allowed.includes(state)) throw new HttpError(400, "invalid_state");
    const record = advanceProvisioning(reference, state);
    if (!record) throw new HttpError(404, "provisioning_not_found");
    return { status: 200, body: { reference: record.reference, state: record.state } };
  });

  return router;
}

function requireCard(cardId: string) {
  const card = getCard(cardId);
  if (!card) throw new HttpError(404, "card_not_found");
  return card;
}
