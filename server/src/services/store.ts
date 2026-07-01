/**
 * store.ts — In-memory issuer data store.
 *
 * Models the two pieces of state a card issuer needs during provisioning:
 *   1. The card portfolio (`cards`) — cardholder, network, and the (fake) Funding PAN.
 *   2. The provisioning ledger (`provisions`) — one row per push-provisioning attempt,
 *      tracking its lifecycle so the app can poll `/status` and webhooks can advance it.
 *
 * A real issuer would back this with a database and an HSM for the PAN. Everything here
 * is synchronous and in-memory so the demo runs with zero infrastructure.
 */

import { randomBytes } from "node:crypto";

export type CardNetwork = "visa" | "mastercard";

export interface Card {
  id: string;
  cardholderName: string;
  /** Fake Funding PAN — never leaves the issuer boundary; only the token is provisioned. */
  fundingPan: string;
  last4: string;
  expiryMonth: string;
  expiryYear: string;
  network: CardNetwork;
  displayName: string;
  /** Whether the account is in good standing / allowed to provision. */
  provisioningEnabled: boolean;
}

export type ProvisioningState = "requested" | "provisioned" | "active" | "failed";

export interface ProvisioningRecord {
  reference: string;
  cardId: string;
  platform: "apple" | "google";
  deviceId: string;
  state: ProvisioningState;
  /** The device token reference (DPAN handle) issued by the network TSP. */
  tokenRef: string;
  network: CardNetwork;
  createdAt: number;
  updatedAt: number;
  history: Array<{ state: ProvisioningState; at: number }>;
}

// Seed portfolio — two eligible cards (Visa + Mastercard) and one blocked card so the
// demo can show the "not eligible" path too.
const cards = new Map<string, Card>([
  [
    "card_demo_visa_4242",
    {
      id: "card_demo_visa_4242",
      cardholderName: "Leandro Perez",
      fundingPan: "4111111111114242",
      last4: "4242",
      expiryMonth: "11",
      expiryYear: "29",
      network: "visa",
      displayName: "SonhoLab Debit",
      provisioningEnabled: true,
    },
  ],
  [
    "card_demo_mc_5100",
    {
      id: "card_demo_mc_5100",
      cardholderName: "Leandro Perez",
      fundingPan: "5100000000005100",
      last4: "5100",
      expiryMonth: "07",
      expiryYear: "28",
      network: "mastercard",
      displayName: "SonhoLab Credit",
      provisioningEnabled: true,
    },
  ],
  [
    "card_demo_blocked_0000",
    {
      id: "card_demo_blocked_0000",
      cardholderName: "Leandro Perez",
      fundingPan: "4111111111110000",
      last4: "0000",
      expiryMonth: "01",
      expiryYear: "27",
      network: "visa",
      displayName: "SonhoLab Blocked",
      provisioningEnabled: false,
    },
  ],
]);

const provisions = new Map<string, ProvisioningRecord>();

export function getCard(cardId: string): Card | undefined {
  return cards.get(cardId);
}

export function listCards(): Card[] {
  return [...cards.values()];
}

export function createProvisioning(args: {
  cardId: string;
  platform: "apple" | "google";
  deviceId: string;
  tokenRef: string;
  network: CardNetwork;
}): ProvisioningRecord {
  const now = Date.now();
  const record: ProvisioningRecord = {
    reference: `prov_${randomBytes(9).toString("hex")}`,
    cardId: args.cardId,
    platform: args.platform,
    deviceId: args.deviceId,
    state: "requested",
    tokenRef: args.tokenRef,
    network: args.network,
    createdAt: now,
    updatedAt: now,
    history: [{ state: "requested", at: now }],
  };
  provisions.set(record.reference, record);
  return record;
}

export function getProvisioning(reference: string): ProvisioningRecord | undefined {
  return provisions.get(reference);
}

export function advanceProvisioning(
  reference: string,
  state: ProvisioningState,
): ProvisioningRecord | undefined {
  const record = provisions.get(reference);
  if (!record) return undefined;
  record.state = state;
  record.updatedAt = Date.now();
  record.history.push({ state, at: record.updatedAt });
  return record;
}
