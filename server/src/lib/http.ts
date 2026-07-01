/**
 * http.ts — A tiny dependency-free HTTP router over `node:http`.
 *
 * The demo backend is intentionally framework-free so it runs with a bare `node` and no
 * `npm install`. The abstractions here (typed JSON handlers, path params, CORS, error
 * mapping) mirror what you'd get from Express/Fastify — swap in a real framework for
 * production; the route handlers stay identical.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../services/provisioning.ts";

export interface RequestContext {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export type Handler = (ctx: RequestContext) => Promise<JsonResponse> | JsonResponse;

export interface JsonResponse {
  status: number;
  body: unknown;
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: Handler) {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: Handler) {
    return this.add("POST", pattern, handler);
  }

  private match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i]!;
        const val = parts[i]!;
        if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(val);
        else if (seg !== val) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  async handle(req: IncomingMessage, res: ServerResponse, corsOrigin: string): Promise<void> {
    setCors(res, corsOrigin);

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const matched = this.match(req.method ?? "GET", url.pathname);

    if (!matched) {
      writeJson(res, { status: 404, body: { error: "not_found", path: url.pathname } });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const result = await matched.route.handler({
        req,
        params: matched.params,
        query: url.searchParams,
        body,
      });
      writeJson(res, result);
    } catch (err) {
      if (err instanceof HttpError) {
        writeJson(res, { status: err.status, body: { error: err.message } });
      } else {
        const message = err instanceof Error ? err.message : "internal_error";
        writeJson(res, { status: 500, body: { error: "internal_error", detail: message } });
      }
    }
  }
}

function setCors(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export function writeJson(res: ServerResponse, response: JsonResponse): void {
  const payload = JSON.stringify(response.body, null, 2);
  res.writeHead(response.status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json_body");
  }
}
