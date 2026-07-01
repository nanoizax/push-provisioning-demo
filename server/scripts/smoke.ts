/**
 * smoke.ts — Self-contained end-to-end smoke test.
 *
 * Boots the router in-process on an ephemeral port and exercises the full API the mobile
 * apps use, asserting on every response. Crucially it verifies that the Apple ECC_V2
 * payload actually decrypts (via the /roundtrip proof), that the Google OPC signature
 * verifies, and that the funding PAN never appears in any payload — i.e. the cryptography
 * is real, not hand-waved.
 *
 * Run: npm run smoke   (no server needs to be running; no dependencies)
 */

import { createServer, type Server } from "node:http";
import { buildRouter } from "../src/routes.ts";
import { verifyOpaquePaymentCard } from "../src/lib/crypto.ts";
import { tspSigningPublicKey } from "../src/services/keys.ts";

const TOKEN = process.env.SESSION_TOKEN ?? "demo-session-token";
const FUNDING_PAN_MC = "5100000000005100"; // seed FPAN that must never leak

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ✅  ${name}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  ❌  ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
}

/** Parse a JSON response body. Typed as `any` so this test script can access fields freely. */
const getJson = (r: Response): Promise<any> => r.json() as Promise<any>;

async function main(): Promise<void> {
  const router = buildRouter();
  const server: Server = createServer((req, res) => void router.handle(req, res, "*"));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://localhost:${port}`;
  const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  process.stdout.write(`\n  Running push-provisioning smoke test against ${base}\n\n`);

  // 1. Health
  const health = await fetch(`${base}/health`).then(getJson);
  check("health returns ok", health.status === "ok");

  // 2. Auth is enforced
  const noAuth = await fetch(`${base}/v1/cards`);
  check("missing bearer -> 401", noAuth.status === 401);

  // 3. Card list
  const cards = await fetch(`${base}/v1/cards`, { headers: auth }).then(getJson);
  check("lists demo cards", Array.isArray(cards.cards) && cards.cards.length >= 2);

  // 4. Eligibility — eligible Visa card
  const elig = await fetch(`${base}/v1/cards/card_demo_visa_4242/eligibility`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ walletPlatform: "apple", deviceId: "dev-1" }),
  }).then(getJson);
  check("visa card is eligible for apple", elig.eligible === true && elig.network === "visa");

  // 5. Eligibility — blocked card is rejected
  const blocked = await fetch(`${base}/v1/cards/card_demo_blocked_0000/eligibility`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ walletPlatform: "google", deviceId: "dev-1" }),
  }).then(getJson);
  check("blocked card is not eligible", blocked.eligible === false);

  // 6. Eligibility is enforced server-side — a blocked card cannot be provisioned directly.
  const blockedProvision = await fetch(`${base}/v1/provisioning/google/opc`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ cardId: "card_demo_blocked_0000", deviceId: "dev-1", walletAccountId: "wa-1" }),
  });
  check("blocked card cannot be provisioned (403)", blockedProvision.status === 403);

  // 7. Apple round-trip — the payload must decrypt back to the network token.
  const apple = await fetch(`${base}/v1/provisioning/apple/roundtrip`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ cardId: "card_demo_visa_4242" }),
  }).then(getJson);
  check("apple payload has all three PassKit fields", Boolean(apple.activationData && apple.encryptedPassData && apple.ephemeralPublicKey));
  check(
    "apple encryptedPassData DECRYPTS to the network token",
    apple.decryptedProof?.tokenReferenceId === apple.tokenReferenceId &&
      typeof apple.decryptedProof?.dpan === "string",
    JSON.stringify(apple.decryptedProof),
  );
  // 8. No funding PAN anywhere in the payload (checks the whole serialized response,
  //    regardless of field name — catches leaks in transport fields too).
  check(
    "clear funding PAN is NOT present anywhere in the apple payload",
    !JSON.stringify(apple).includes("4111111111114242"),
  );

  // 9. Google OPC + signature verification (proves the OPC is issuer-authentic).
  const google = await fetch(`${base}/v1/provisioning/google/opc`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ cardId: "card_demo_mc_5100", deviceId: "dev-1", walletAccountId: "wa-1" }),
  }).then(getJson);
  check("google returns an OPC + mastercard TSP", Boolean(google.opc) && google.tokenServiceProvider === "TOKEN_PROVIDER_MASTERCARD" && google.network === "NETWORK_MASTERCARD");
  check("google OPC signature verifies against the TSP key", verifyOpaquePaymentCard(google.opc, tspSigningPublicKey()));
  check("funding PAN is NOT present in the google OPC response", !JSON.stringify(google).includes(FUNDING_PAN_MC));

  // 10. Status lifecycle: invalid transitions rejected, valid ones accepted.
  const ref = google.reference as string;
  const status1 = await fetch(`${base}/v1/provisioning/${ref}/status`, { headers: auth }).then(getJson);
  check("initial state is requested", status1.state === "requested");

  const illegal = await fetch(`${base}/v1/webhooks/network`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ reference: ref, state: "active" }),
  });
  check("illegal transition requested->active is rejected (409)", illegal.status === 409);

  await fetch(`${base}/v1/webhooks/network`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ reference: ref, state: "provisioned" }),
  });
  await fetch(`${base}/v1/webhooks/network`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ reference: ref, state: "active" }),
  });
  const status2 = await fetch(`${base}/v1/provisioning/${ref}/status`, { headers: auth }).then(getJson);
  check("webhook advances lifecycle to active", status2.state === "active");

  await new Promise<void>((resolve) => server.close(() => resolve()));

  process.stdout.write(`\n  ${passed} passed, ${failed} failed\n\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
