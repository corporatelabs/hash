import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MiniRedis } from "../../src/storage/redis-client.js";
import { RedisBackend } from "../../src/storage/redis.js";
import { sampleRecord } from "../helpers/record.js";

const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
let backend: RedisBackend | null = null;

async function connect(): Promise<RedisBackend | null> {
  let probe: MiniRedis | null = null;
  try {
    probe = await MiniRedis.connect(url, 400);
    await probe.ping();
    await probe.quit();
  } catch {
    probe?.disconnect();
    return null;
  }
  const prefix = `hash:test:${crypto.randomUUID()}`;
  return RedisBackend.connect(url, prefix);
}

describe("redis", () => {
  beforeAll(async () => {
    backend = await connect();
    if (!backend && process.env.CI === "true") throw new Error("Redis is required in CI");
  });

  afterAll(async () => {
    await backend?.close();
  });

  it("lets exactly one concurrent reader burn a one-time snippet", async () => {
    if (!backend) return;
    const now = Date.now();
    const record = sampleRecord(now, { burnAfterRead: true });
    expect(await backend.snippets.create(record)).toBe("created");
    const results = await Promise.all(Array.from({ length: 8 }, () => backend?.snippets.open(record.id, now)));
    const ok = results.filter((result) => result?.status === "ok");
    expect(ok).toHaveLength(1);
    expect(results.filter((result) => result?.status === "gone" && result.reason === "burned")).toHaveLength(7);
    const again = await backend.snippets.open(record.id, now);
    expect(again).toEqual({ status: "gone", reason: "burned" });
  });

  it("expires without handing out ciphertext", async () => {
    if (!backend) return;
    const now = Date.now();
    const record = sampleRecord(now, { expiresAt: now - 5_000, burnAfterRead: true });
    expect(await backend.snippets.create(record)).toBe("created");
    const results = await Promise.all(Array.from({ length: 6 }, () => backend?.snippets.open(record.id, now)));
    expect(results.every((result) => result?.status === "gone" && result.reason === "expired")).toBe(true);
  });
});
