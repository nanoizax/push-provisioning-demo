/**
 * index.ts — Boots the mock issuer / TSP HTTP server.
 *
 * Run with a modern Node (>= 22.6) — no build step, no dependencies:
 *   node --experimental-strip-types src/index.ts
 * or via the npm scripts: `npm run dev` (watch) / `npm start`.
 */

import { createServer } from "node:http";
import { buildRouter } from "./routes.ts";

const PORT = Number(process.env.PORT ?? 8787);
// Demo default is "*" so the offline browser demo works from any origin (incl. file://).
// In production set CORS_ORIGIN to a concrete allowlisted origin.
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

const router = buildRouter();

const server = createServer((req, res) => {
  void router.handle(req, res, CORS_ORIGIN).catch((err) => {
    // Last-resort guard: the router already maps known errors; this only fires on a bug.
    if (!res.headersSent) {
      process.stderr.write(`[fatal] ${String(err)}\n`);
      res.writeHead(500, { "Content-Type": "application/json" });
      const body = process.env.DEBUG_ERRORS === "1"
        ? { error: "unhandled", detail: String(err) }
        : { error: "unhandled" };
      res.end(JSON.stringify(body));
    }
  });
});

server.listen(PORT, () => {
  process.stdout.write(
    `\n  🏦  Issuer / TSP provisioning server\n` +
      `      Listening on http://localhost:${PORT}\n` +
      `      Health:      http://localhost:${PORT}/health\n` +
      `      CORS origin: ${CORS_ORIGIN}\n\n`,
  );
});
