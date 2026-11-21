import { isValidId } from "../shared/link.js";
import { MAX_REQUEST_BYTES, RATE_LIMITS, type HashEnvironment } from "../shared/protocol.js";
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

export interface HashApp {
  fetch(request: Request): Promise<Response>;
}

function log(event: string, fields: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
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

function withSecurity(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers, request, headerKind(new URL(request.url).pathname));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const extra = error.extra?.retryAfter !== undefined ? { "retry-after": String(error.extra.retryAfter) } : undefined;
    return json(error.body(), error.status, extra);
  }
  if (error instanceof StorageUnavailable) {
    log("storage.unavailable");
    return json({ error: "unavailable" }, 503);
  }
  log("unhandled", { name: error instanceof Error ? error.name : "Error" });
  return json({ error: "internal" }, 500);
}

async function dispatch(runtime: HashRuntime, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if ((pathname === "/healthz" || pathname === "/health") && method === "GET") {
    return json({ ok: true }, 200);
  }

  const rejectPepper = (op: "create" | "open"): void => {
    const problem = pepperProblem(runtime.environment, runtime.pepper);
    if (!problem) return;
    log("misconfigured", { op, problem });
    throw new HttpError(503, "misconfigured");
  };

  if (pathname === "/api/snippets") {
    if (method !== "POST") return json({ error: "method" }, 405, { allow: "POST" });
    if (!sameOrigin(request)) throw new HttpError(403, "origin");
    rejectPepper("create");
    const ip = resolveIp(runtime, request);
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
    const parsed = parseCreateBody(await readJson(request), Date.now(), runtime.environment);
    if (!parsed.ok) throw new HttpError(parsed.status, parsed.error, parsed.field);
    const record: SnippetRecord = { ...parsed.value, createdAt: Date.now() };
    const result = await runtime.store.create(record);
    if (result === "conflict") throw new HttpError(409, "conflict");
    log("snippet.create", { burn: record.burnAfterRead });
    return json({ id: record.id, expiresAt: record.expiresAt, burnAfterRead: record.burnAfterRead }, 201);
  }

  const openMatch = /^\/api\/snippets\/([^/]+)\/open$/.exec(pathname);
  if (openMatch) {
    if (method !== "POST") return json({ error: "method" }, 405, { allow: "POST" });
    if (!sameOrigin(request)) throw new HttpError(403, "origin");
    rejectPepper("open");
    const id = openMatch[1] ?? "";
    if (!isValidId(id)) return json({ error: "gone", reason: "missing" }, 404);
    const length = request.headers.get("content-length");
    if (length !== null && Number(length) > 1024) throw new HttpError(413, "too_large");
    const ip = resolveIp(runtime, request);
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
      return json({ error: "gone", reason: opened.reason }, status);
    }
    log("snippet.open", { burn: opened.burned });
    return json(
      {
        v: 1,
        id: opened.record.id,
        ciphertext: opened.record.ciphertext,
        nonce: opened.record.nonce,
        salt: opened.record.salt,
        kdf: opened.record.kdf,
        expiresAt: opened.record.expiresAt,
        burnAfterRead: opened.record.burnAfterRead,
      },
      200,
    );
  }

  if (method !== "GET" && method !== "HEAD") return text("Not found", 404);
  return runtime.serve(request);
}

export function createApp(runtime: HashRuntime): HashApp {
  return {
    async fetch(request) {
      try {
        return withSecurity(await dispatch(runtime, request), request);
      } catch (error) {
        return withSecurity(errorResponse(error), request);
      }
    },
  };
}
