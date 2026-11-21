const WEEK = 7 * 24 * 60 * 60 * 1000;
const KDF = { name: "argon2id" as const, version: 1 as const, m: 65536, t: 3, p: 1, hashLen: 32 as const };

export interface ApiCall {
  method: string;
  ip: string;
  body?: string;
  origin?: string;
}

interface RecordBody {
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: { name: "argon2id"; version: 1; m: number; t: number; p: number; hashLen: 32 };
}

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

function b64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64url(value: Uint8Array): string {
  return b64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: ${String(actual)} !== ${String(expected)}`);
}

function deepEqual(actual: unknown, expected: unknown, label: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}: ${left} !== ${right}`);
}

function sample(patch: Partial<RecordBody> = {}): RecordBody {
  return {
    id: b64url(bytes(16)),
    ciphertext: b64(bytes(32)),
    nonce: b64(bytes(12)),
    salt: b64(bytes(16)),
    expiresAt: Date.now() + WEEK,
    burnAfterRead: false,
    kdf: { ...KDF },
    ...patch,
  };
}

function bodyOf(record: RecordBody): RecordBody {
  return {
    id: record.id,
    ciphertext: record.ciphertext,
    nonce: record.nonce,
    salt: record.salt,
    expiresAt: record.expiresAt,
    burnAfterRead: record.burnAfterRead,
    kdf: record.kdf,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) throw new Error("json");
  return value as Record<string, unknown>;
}

/**
 * HTTP behavior shared by the Node server (Docker) and the Worker.
 * `request` must send `init.ip` as the platform client address.
 */
export async function exerciseHashApi(options: {
  request: (path: string, init: ApiCall) => Promise<Response>;
  allowPastExpiry: boolean;
}): Promise<void> {
  const { request, allowPastExpiry } = options;
  let octet = 10;
  const nextIp = () => {
    octet += 1;
    if (octet > 250) throw new Error("exhausted test addresses");
    return `203.0.113.${octet}`;
  };

  const health = await request("/healthz", { method: "GET", ip: nextIp() });
  equal(health.status, 200, "health");
  equal(health.headers.get("referrer-policy"), "no-referrer", "referrer");
  equal(health.headers.get("x-content-type-options"), "nosniff", "nosniff");
  equal(health.headers.get("cache-control"), "no-store", "cache");
  const csp = health.headers.get("content-security-policy") ?? "";
  if (!csp.includes("default-src 'none'")) throw new Error("csp default");
  if (!csp.includes("wasm-unsafe-eval")) throw new Error("csp wasm");
  if (csp.includes("unsafe-inline")) throw new Error("csp inline");
  deepEqual(await json(health), { ok: true }, "health body");

  const method = await request("/api/snippets", { method: "GET", ip: nextIp() });
  equal(method.status, 405, "method");
  deepEqual(await json(method), { error: "method" }, "method body");

  const missing = await request("/api/snippets/AAAAAAAAAAAAAAAAAAAAAA/open", { method: "POST", ip: nextIp() });
  equal(missing.status, 404, "missing");
  deepEqual(await json(missing), { error: "gone", reason: "missing" }, "missing body");

  const burned = sample({ burnAfterRead: true });
  const created = await request("/api/snippets", { method: "POST", ip: nextIp(), body: JSON.stringify(bodyOf(burned)) });
  equal(created.status, 201, "create");
  equal(created.headers.get("cache-control"), "no-store", "create cache");
  const page = await request(`/s/${burned.id}`, { method: "GET", ip: nextIp() });
  equal(page.status, 200, "page");
  if (!(page.headers.get("content-type") ?? "").includes("text/html")) throw new Error("page type");
  await page.text();
  const first = await request(`/api/snippets/${burned.id}/open`, { method: "POST", ip: nextIp() });
  equal(first.status, 200, "open");
  const payload = await json(first);
  equal(payload.ciphertext, burned.ciphertext, "ciphertext");
  equal(payload.burnAfterRead, true, "burn flag");
  if (JSON.stringify(payload).includes("fragment")) throw new Error("fragment leaked");
  const second = await request(`/api/snippets/${burned.id}/open`, { method: "POST", ip: nextIp() });
  equal(second.status, 410, "second open");
  deepEqual(await json(second), { error: "gone", reason: "burned" }, "burned body");

  const raced = sample({ burnAfterRead: true });
  const racedCreate = await request("/api/snippets", { method: "POST", ip: nextIp(), body: JSON.stringify(bodyOf(raced)) });
  equal(racedCreate.status, 201, "race create");
  await racedCreate.json();
  const [left, right] = await Promise.all([
    request(`/api/snippets/${raced.id}/open`, { method: "POST", ip: nextIp() }),
    request(`/api/snippets/${raced.id}/open`, { method: "POST", ip: nextIp() }),
  ]);
  const statuses = [left.status, right.status].sort();
  deepEqual(statuses, [200, 410], "race");
  await left.text();
  await right.text();

  const past = sample({ expiresAt: Date.now() - 5_000 });
  const pastCreate = await request("/api/snippets", { method: "POST", ip: nextIp(), body: JSON.stringify(bodyOf(past)) });
  if (allowPastExpiry) {
    equal(pastCreate.status, 201, "past create");
    await pastCreate.json();
    const opened = await request(`/api/snippets/${past.id}/open`, { method: "POST", ip: nextIp() });
    equal(opened.status, 410, "expired");
    deepEqual(await json(opened), { error: "gone", reason: "expired" }, "expired body");
  } else {
    equal(pastCreate.status, 400, "clock");
    equal((await json(pastCreate)).error, "clock_skew", "clock body");
  }

  const crossRecord = sample();
  const cross = await request("/api/snippets", {
    method: "POST",
    ip: nextIp(),
    origin: "https://evil.example",
    body: JSON.stringify(bodyOf(crossRecord)),
  });
  equal(cross.status, 403, "origin");
  await cross.text();

  const weak = sample();
  weak.kdf = { ...KDF, m: 8 };
  const bad = await request("/api/snippets", { method: "POST", ip: nextIp(), body: JSON.stringify(bodyOf(weak)) });
  equal(bad.status, 400, "kdf");
  await bad.text();

  const limitedIp = nextIp();
  let limited = 0;
  let retryAfter = "";
  for (let i = 0; i < 12; i += 1) {
    const response = await request("/api/snippets", {
      method: "POST",
      ip: limitedIp,
      body: JSON.stringify(bodyOf(sample())),
    });
    if (response.status === 429) {
      limited += 1;
      retryAfter = response.headers.get("retry-after") ?? "";
      const payload = await json(response);
      if (payload.error !== "rate_limited" || typeof payload.retryAfter !== "number") throw new Error("rate body");
    } else {
      await response.text();
    }
  }
  if (limited < 1) throw new Error("expected a 429");
  if (!/^\d+$/.test(retryAfter)) throw new Error("retry-after");
}

function readArgs(argv: string[]): { base: string; allowPastExpiry: boolean } {
  let base = "";
  let allowPastExpiry = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--past-expiry") allowPastExpiry = true;
    else if (arg === "--base") base = argv[i + 1] ?? "";
  }
  return { base, allowPastExpiry };
}

const argv = globalThis.process?.argv;
if (argv?.includes("--base")) {
  const { base, allowPastExpiry } = readArgs(argv.slice(2));
  if (!base) {
    console.error("missing --base");
    process.exit(1);
  }
  await exerciseHashApi({
    allowPastExpiry,
    request: (path: string, init: ApiCall) => {
      const headers: Record<string, string> = { "x-forwarded-for": init.ip, "cf-connecting-ip": init.ip };
      if (init.body) headers["content-type"] = "application/json";
      if (init.origin) headers.origin = init.origin;
      const initRequest: RequestInit = { method: init.method, headers };
      if (init.body !== undefined) initRequest.body = init.body;
      return fetch(new URL(path, base), initRequest);
    },
  });
  console.log(JSON.stringify({ ok: true, base, allowPastExpiry }));
}
