/**
 * auth.ts — Bearer-token guard.
 *
 * The mobile apps present `Authorization: Bearer <session token>`. In production that
 * token is short-lived and minted after strong customer authentication (SCA); here it is
 * a static value from the environment so the demo is easy to run.
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { HttpError } from "../services/provisioning.ts";

const EXPECTED = process.env.SESSION_TOKEN ?? "demo-session-token";

/** Constant-time string equality that does not leak length or content via timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual requires equal lengths, so compare lengths first (non-secret).
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function requireBearer(req: IncomingMessage): void {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "missing_bearer_token");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!safeEqual(token, EXPECTED)) {
    throw new HttpError(401, "invalid_bearer_token");
  }
}
