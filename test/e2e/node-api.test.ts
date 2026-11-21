import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startHttpServer, type RunningServer } from "../../src/adapters/node/server.js";
import { createFileServer } from "../../src/adapters/node/static.js";
import type { RateLimitStore, SnippetStore } from "../../src/core/store.js";
import { SqliteBackend } from "../../src/storage/sqlite.js";
import { MiniRedis } from "../../src/storage/redis-client.js";
import { RedisBackend } from "../../src/storage/redis.js";
import { exerciseHashApi, type ApiCall } from "../../scripts/api-parity.js";
import { createBody, sampleRecord } from "../helpers/record.js";

function requestFor(base: string) {
  return (pathname: string, init: ApiCall): Promise<Response> => {
    const headers = new Headers({ "x-forwarded-for": init.ip, "cf-connecting-ip": init.ip });
    if (init.body) headers.set("content-type", "application/json");
    if (init.origin) headers.set("origin", init.origin);
    const requestInit: RequestInit = { method: init.method, headers };
    if (init.body !== undefined) requestInit.body = init.body;
    return fetch(new URL(pathname, base), requestInit);
  };
}

async function listen(store: { snippets: SnippetStore; rateLimit: RateLimitStore }, environment: "test" | "development") {
  return startHttpServer({
    host: "127.0.0.1",
    port: 0,
    runtime: {
      environment,
      pepper: "development-only-pepper",
      store: store.snippets,
      rateLimit: store.rateLimit,
      trustProxy: true,
      serve: createFileServer(path.join(process.cwd(), "dist/client")),
    },
  });
}

describe("node api parity", () => {
  const running: RunningServer[] = [];
  const sqlite: SqliteBackend[] = [];
  const redis: RedisBackend[] = [];

  afterAll(async () => {
    await Promise.all(running.map((server) => server.close()));
    for (const db of sqlite) db.close();
    await Promise.all(redis.map((backend) => backend.close()));
  });

  it("matches the worker API on sqlite, including expiry and sweep", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hash-node-api-"));
    const db = SqliteBackend.open(path.join(dir, "hash.sqlite"));
    sqlite.push(db);
    const server = await listen(db, "test");
    running.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    await exerciseHashApi({ request: requestFor(base), allowPastExpiry: true });

    const dev = await listen(db, "development");
    running.push(dev);
    await exerciseHashApi({ request: requestFor(`http://127.0.0.1:${dev.port}`), allowPastExpiry: false });

    const expired = sampleRecord(Date.now(), { expiresAt: Date.now() - 5_000 });
    const created = await fetch(`${base}/api/snippets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify(createBody(expired)),
    });
    expect(created.status).toBe(201);
    expect(db.ciphertextStored(expired.id)).toBe(true);
    db.sweep(Date.now());
    expect(db.ciphertextStored(expired.id)).toBe(false);
    const opened = await fetch(`${base}/api/snippets/${expired.id}/open`, {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.8" },
    });
    expect(opened.status).toBe(410);
    expect(await opened.json()).toEqual({ error: "gone", reason: "expired" });
  });

  it("matches the worker API on redis when Redis is up", async () => {
    const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    let probe: MiniRedis | null = null;
    try {
      probe = await MiniRedis.connect(url, 400);
      await probe.ping();
      await probe.quit();
    } catch {
      probe?.disconnect();
      if (process.env.CI === "true") throw new Error("Redis is required in CI");
      return;
    }
    const prefix = `hash:test:${crypto.randomUUID()}`;
    const backend = await RedisBackend.connect(url, prefix);
    redis.push(backend);
    const server = await listen(backend, "test");
    running.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    await exerciseHashApi({ request: requestFor(base), allowPastExpiry: true });

    const expired = sampleRecord(Date.now(), { expiresAt: Date.now() - 5_000 });
    const created = await fetch(`${base}/api/snippets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
      body: JSON.stringify(createBody(expired)),
    });
    expect(created.status).toBe(201);
    const look = await MiniRedis.connect(url, 400);
    try {
      expect(await look.get(`${prefix}:snippet:${expired.id}`)).not.toBeNull();
      await backend.sweep(Date.now());
      expect(await look.get(`${prefix}:snippet:${expired.id}`)).toBeNull();
    } finally {
      await look.quit();
    }
    const opened = await fetch(`${base}/api/snippets/${expired.id}/open`, {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.8" },
    });
    expect(opened.status).toBe(410);
    expect(await opened.json()).toEqual({ error: "gone", reason: "expired" });
  });
});
