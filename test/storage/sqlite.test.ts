import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import esbuild from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteBackend } from "../../src/storage/sqlite.js";
import { sampleRecord } from "../helpers/record.js";
import type { OpenResult } from "../../src/core/store.js";

const open: SqliteBackend[] = [];

afterEach(() => {
  for (const db of open) db.close();
  open.length = 0;
});

function fresh(): SqliteBackend {
  const dir = mkdtempSync(path.join(tmpdir(), "hash-sqlite-"));
  const db = SqliteBackend.open(path.join(dir, "hash.sqlite"));
  open.push(db);
  return db;
}

async function race(dbPath: string, id: string, now: number, count: number): Promise<OpenResult[]> {
  const outfile = path.join(process.cwd(), "dist/test/open-worker.mjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(process.cwd(), "test/storage/open-worker.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
  const runs = Array.from({ length: count }, () =>
    new Promise<OpenResult>((resolve, reject) => {
      const worker = new Worker(outfile, { execArgv: [], workerData: { dbPath, id, now } });
      worker.once("message", resolve);
      worker.once("error", reject);
    }),
  );
  return Promise.all(runs);
}

describe("sqlite", () => {
  it("burns a one-time snippet exactly once under concurrent readers", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hash-race-"));
    const dbPath = path.join(dir, "hash.sqlite");
    const db = SqliteBackend.open(dbPath);
    const now = Date.now();
    const record = sampleRecord(now, { burnAfterRead: true });
    expect(await db.snippets.create(record)).toBe("created");
    db.close();
    const results = await race(dbPath, record.id, now, 8);
    const ok = results.filter((result) => result.status === "ok");
    const gone = results.filter((result) => result.status === "gone");
    expect(ok).toHaveLength(1);
    expect(gone).toHaveLength(7);
    expect(gone.every((result) => result.status === "gone" && result.reason === "burned")).toBe(true);
    const check = SqliteBackend.open(dbPath);
    expect(check.ciphertextStored(record.id)).toBe(false);
    check.close();
  });

  it("expires without returning ciphertext, even to concurrent readers", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hash-exp-"));
    const dbPath = path.join(dir, "hash.sqlite");
    const db = SqliteBackend.open(dbPath);
    const now = Date.now();
    const record = sampleRecord(now, { expiresAt: now - 1_000, burnAfterRead: true });
    expect(await db.snippets.create(record)).toBe("created");
    db.close();
    const results = await race(dbPath, record.id, now, 6);
    expect(results.every((result) => result.status === "gone" && result.reason === "expired")).toBe(true);
    const check = SqliteBackend.open(dbPath);
    expect(check.ciphertextStored(record.id)).toBe(false);
    check.close();
  });

  it("rate limits inside a transaction", async () => {
    const db = fresh();
    const now = 1_000_000;
    const first = await db.rateLimit.consume("bucket", 2, 10_000, now);
    const second = await db.rateLimit.consume("bucket", 2, 10_000, now + 1);
    const third = await db.rateLimit.consume("bucket", 2, 10_000, now + 2);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });
});
