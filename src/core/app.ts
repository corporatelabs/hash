import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isValidId } from "../shared/link.js";
import {
  MAX_REQUEST_BYTES,
  RATE_LIMITS,
  type HashEnvironment,
} from "../shared/protocol.js";
import { HttpError } from "./errors.js";
import { applySecurityHeaders, headerKind } from "./headers.js";
import { pepperProblem, rateBucket } from "./rate-key.js";
import { StorageUnavailable, type RateLimitStore, type SnippetRecord, type SnippetStore } from "./store.js";
import { parseCreateBody } from "./validate.js";

export interface HashRuntime {
  environment: HashEnvironment;
  pepper: string;
  store: SnippetStore;
  rateLimit: RateLimitStore;
  clientAddress: (request: Request) => string | null;
  serve: (request: Request) => Promise<Response> | Response;
}

function log(event: string, fields: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) {
    throw new HttpError(413, "too_large");
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_REQUEST_BYTES) throw new HttpError(413, "too_large");
  if (buf.byteLength === 0) throw new HttpError(400, "invalid_body");
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(400, "invalid_body");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf));
  } catch {
    throw new HttpError(400, "invalid_body");
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function resolveIp(runtime: HashRuntime, request: Request): string {
  const ip = runtime.clientAddress(request);
  if (ip) return ip;
  if (runtime.environment === "production") throw new HttpError(503, "misconfigured");
  return "local";
}

export function createApp(runtime: HashRuntime): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    const headers = new Headers(c.res.headers);
    applySecurityHeaders(headers, c.req.raw, headerKind(c.req.path));
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const headers = err.extra?.retryAfter !== undefined ? { "retry-after": String(err.extra.retryAfter) } : undefined;
      return c.json(err.body(), err.status as ContentfulStatusCode, headers);
    }
    if (err instanceof StorageUnavailable) {
      log("storage.unavailable");
      return c.json({ error: "unavailable" }, 503);
    }
    log("unhandled", { name: err instanceof Error ? err.name : "Error" });
    return c.json({ error: "internal" }, 500);
  });

  const health = (c: { json: (body: unknown) => Response }) => c.json({ ok: true });
  app.get("/healthz", health);
  app.get("/health", health);

  const rejectPepper = (op: "create" | "open"): void => {
    const problem = pepperProblem(runtime.environment, runtime.pepper);
    if (!problem) return;
    log("misconfigured", { op, problem });
    throw new HttpError(503, "misconfigured");
  };

  app.post("/api/snippets", async (c) => {
    if (!sameOrigin(c.req.raw)) throw new HttpError(403, "origin");
    rejectPepper("create");
    const ip = resolveIp(runtime, c.req.raw);
    const decision = await runtime.rateLimit.consume(
      await rateBucket(runtime.pepper, ip, "create"),
      RATE_LIMITS.create.limit,
      RATE_LIMITS.create.windowMs,
      Date.now(),
    );
    if (!decision.allowed) {
      const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      throw new HttpError(429, "rate_limited", undefined, { retryAfter });
    }
    const parsed = parseCreateBody(await readJson(c.req.raw), Date.now(), runtime.environment);
    if (!parsed.ok) throw new HttpError(parsed.status, parsed.error, parsed.field);
    const record: SnippetRecord = { ...parsed.value, createdAt: Date.now() };
    const result = await runtime.store.create(record);
    if (result === "conflict") throw new HttpError(409, "conflict");
    log("snippet.create", { burn: record.burnAfterRead });
    return c.json({ id: record.id, expiresAt: record.expiresAt, burnAfterRead: record.burnAfterRead }, 201);
  });

  app.post("/api/snippets/:id/open", async (c) => {
    if (!sameOrigin(c.req.raw)) throw new HttpError(403, "origin");
    rejectPepper("open");
    const id = c.req.param("id");
    if (!isValidId(id)) return c.json({ error: "gone", reason: "missing" }, 404);
    const length = c.req.raw.headers.get("content-length");
    if (length !== null && Number(length) > 1024) throw new HttpError(413, "too_large");
    const ip = resolveIp(runtime, c.req.raw);
    const decision = await runtime.rateLimit.consume(
      await rateBucket(runtime.pepper, ip, "open"),
      RATE_LIMITS.open.limit,
      RATE_LIMITS.open.windowMs,
      Date.now(),
    );
    if (!decision.allowed) {
      const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      throw new HttpError(429, "rate_limited", undefined, { retryAfter });
    }
    const opened = await runtime.store.open(id, Date.now());
    if (opened.status === "gone") {
      const status = opened.reason === "missing" ? 404 : 410;
      return c.json({ error: "gone", reason: opened.reason }, status);
    }
    log("snippet.open", { burn: opened.burned });
    return c.json({
      v: 1,
      id: opened.record.id,
      ciphertext: opened.record.ciphertext,
      nonce: opened.record.nonce,
      salt: opened.record.salt,
      kdf: opened.record.kdf,
      expiresAt: opened.record.expiresAt,
      burnAfterRead: opened.record.burnAfterRead,
    });
  });

  app.on(["GET", "PUT", "PATCH", "DELETE"], "/api/snippets", (c) => {
    return c.json({ error: "method" }, 405, { allow: "POST" });
  });
  app.on(["GET", "PUT", "PATCH", "DELETE"], "/api/snippets/:id/open", (c) => {
    return c.json({ error: "method" }, 405, { allow: "POST" });
  });

  app.all("*", async (c) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.text("Not found", 404);
    }
    return runtime.serve(c.req.raw);
  });

  return app;
}
