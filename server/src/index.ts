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
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

const router = buildRouter();

const server = createServer((req, res) => {
  void router.handle(req, res, CORS_ORIGIN).catch((err) => {
    // Last-resort guard: the router already maps known errors; this only fires on a bug.
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unhandled", detail: String(err) }));
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
