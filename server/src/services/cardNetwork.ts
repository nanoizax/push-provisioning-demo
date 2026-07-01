/**
 * cardNetwork.ts — Mock Token Service Provider (Visa VDEP / Mastercard MDES).
 *
 * In a real integration the issuer calls the card network's tokenization service to turn
 * a Funding PAN (FPAN) into a device-bound network token (DPAN). The network returns:
 *   - a token reference id (a handle the issuer stores; never the raw DPAN),
 *   - a Payment Account Reference (PAR) that links all tokens of one funding account,
 *   - the token's own expiry.
 *
 * The clear PAN never reaches the device: the app receives only the encrypted payload
 * (Apple) or OPC (Google) that carries the *token*, not the FPAN.
 *
 * This module simulates that service deterministically so the demo is reproducible.
 */

import { createHash } from "node:crypto";
import type { CardNetwork } from "./store.ts";

export interface NetworkToken {
  /** Device token (DPAN). Kept server-side; only the encrypted form reaches the wallet. */
  dpan: string;
  /** Opaque handle the issuer persists to reference this token later. */
  tokenReferenceId: string;
  /** Payment Account Reference — stable across all tokens of the same funding account. */
  par: string;
  expiryMonth: string;
  expiryYear: string;
  network: CardNetwork;
  tokenServiceProvider: "TOKEN_PROVIDER_VISA" | "TOKEN_PROVIDER_MASTERCARD";
}

/** Map an internal network name to the TapAndPay token service provider constant name. */
export function tokenServiceProviderFor(
  network: CardNetwork,
): NetworkToken["tokenServiceProvider"] {
  return network === "visa" ? "TOKEN_PROVIDER_VISA" : "TOKEN_PROVIDER_MASTERCARD";
}

/** Map an internal network name to the TapAndPay card network constant name. */
export function tapAndPayNetworkFor(network: CardNetwork): "NETWORK_VISA" | "NETWORK_MASTERCARD" {
  return network === "visa" ? "NETWORK_VISA" : "NETWORK_MASTERCARD";
}

/**
 * Request a network token for a funding PAN bound to a specific device.
 *
 * Deterministic by design: the same (FPAN, deviceId) always yields the same token, which
 * makes the demo and its tests reproducible. A real TSP issues a fresh random DPAN and
 * performs an Identification & Verification (ID&V) risk decision here.
 */
export function tokenize(args: {
  fundingPan: string;
  deviceId: string;
  network: CardNetwork;
  expiryMonth: string;
  expiryYear: string;
}): NetworkToken {
  const seed = createHash("sha256")
    .update(args.fundingPan)
    .update("|")
    .update(args.deviceId)
    .digest("hex");

  // Derive a plausible 16-digit DPAN that starts with the network's BIN range but is
  // clearly distinct from the FPAN (tokens live in dedicated token BIN ranges).
  const bin = args.network === "visa" ? "4" : "5";
  const digits = seed.replace(/\D/g, "").padEnd(15, "0").slice(0, 15);
  const dpan = (bin + digits).slice(0, 16);

  return {
    dpan,
    tokenReferenceId: `tkn_${seed.slice(0, 24)}`,
    par: `PAR${seed.slice(0, 26).toUpperCase()}`,
    expiryMonth: args.expiryMonth,
    expiryYear: args.expiryYear,
    network: args.network,
    tokenServiceProvider: tokenServiceProviderFor(args.network),
  };
}
