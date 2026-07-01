/**
 * keys.ts — Long-lived cryptographic material for the mock issuer / TSP.
 *
 * Generated once at boot and kept in memory. In production these live in an HSM / KMS:
 *   - `tspSigning*`  : the EC key pair that signs Google OPC envelopes (issuer authenticity).
 *   - `contentKey`   : the symmetric key the TSP shares with the wallet backend to encrypt
 *                      OPC content. (Real integrations negotiate this during onboarding.)
 */

import { randomBytes, type KeyObject } from "node:crypto";
import { generateP256KeyPair } from "../lib/crypto.ts";

const tspSigningPair = generateP256KeyPair();
const contentKey = randomBytes(32);

export function tspSigningPrivateKey(): KeyObject {
  return tspSigningPair.privateKey;
}

export function tspSigningPublicKey(): KeyObject {
  return tspSigningPair.publicKey;
}

export function opcContentKey(): Buffer {
  return contentKey;
}
