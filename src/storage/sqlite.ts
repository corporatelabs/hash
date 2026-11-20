import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TOMBSTONE_MS, type GoneReason, type KdfParams } from "../shared/protocol.js";
import {
  sameSnippet,
  type OpenResult,
  type RateDecision,
  type RateLimitStore,
  type RateRejection,
  type SnippetRecord,
  type SnippetStore,
} from "../core/store.js";

interface ActiveRow {
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  kdf_m: number;
  kdf_t: number;
  kdf_p: number;
  kdf_hash_len: number;
  expires_at: number;
  burn_after_read: number;
  created_at: number;
}

interface TombRow {
  id: string;
  reason: string;
  until_ms: number;
}

function num(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function asActive(row: Record<string, unknown> | undefined): ActiveRow | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    ciphertext: String(row.ciphertext),
    nonce: String(row.nonce),
    salt: String(row.salt),
    kdf_m: num(row.kdf_m),
    kdf_t: num(row.kdf_t),
    kdf_p: num(row.kdf_p),
    kdf_hash_len: num(row.kdf_hash_len),
    expires_at: num(row.expires_at),
    burn_after_read: num(row.burn_after_read),
    created_at: num(row.created_at),
  };
}

function asTomb(row: Record<string, unknown> | undefined): TombRow | undefined {
  if (!row) return undefined;
  return { id: String(row.id), reason: String(row.reason), until_ms: num(row.until_ms) };
}

function rowToRecord(row: ActiveRow): SnippetRecord {
  const kdf: KdfParams = {
    name: "argon2id",
    version: 1,
    m: row.kdf_m,
    t: row.kdf_t,
    p: row.kdf_p,
    hashLen: row.kdf_hash_len,
  };
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    salt: row.salt,
    kdf,
    expiresAt: row.expires_at,
    burnAfterRead: row.burn_after_read === 1,
    createdAt: row.created_at,
  };
}

function asGone(reason: string): GoneReason {
  return reason === "expired" || reason === "burned" ? reason : "missing";
}

function immediate<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction is already closed.
    }
    throw error;
  }
}

/**
 * SQLite store on Node's built-in `node:sqlite`. Burn and expiry use
 * `DELETE ... RETURNING` inside an IMMEDIATE transaction.
 */
export class SqliteBackend {
  readonly snippets: SnippetStore;
  readonly rateLimit: RateLimitStore;
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS snippets (
        id TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        nonce TEXT NOT NULL,
        salt TEXT NOT NULL,
        kdf_m INTEGER NOT NULL,
        kdf_t INTEGER NOT NULL,
        kdf_p INTEGER NOT NULL,
        kdf_hash_len INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        burn_after_read INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS tombstones (
        id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        until_ms INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_start INTEGER NOT NULL
      ) STRICT;
    `);

    const read = db.prepare("SELECT * FROM snippets WHERE id = ?");
    const expire = db.prepare("DELETE FROM snippets WHERE id = ? AND expires_at <= ? RETURNING *");
    const burn = db.prepare("DELETE FROM snippets WHERE id = ? AND burn_after_read = 1 RETURNING *");
    const tombstone = db.prepare(
      `INSERT INTO tombstones (id, reason, until_ms) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET reason = excluded.reason, until_ms = excluded.until_ms`,
    );
    const readTomb = db.prepare("SELECT id, reason, until_ms FROM tombstones WHERE id = ?");
    const deleteTomb = db.prepare("DELETE FROM tombstones WHERE id = ?");
    const insert = db.prepare(
      `INSERT INTO snippets (
        id, ciphertext, nonce, salt, kdf_m, kdf_t, kdf_p, kdf_hash_len, expires_at, burn_after_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const rateGet = db.prepare("SELECT count, window_start FROM rate_limits WHERE bucket = ?");
    const rateUpsert = db.prepare(
      `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, ?, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`,
    );
    const rateInc = db.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?");

    this.snippets = {
      create: (record) =>
        Promise.resolve(
          immediate(db, (): "created" | "conflict" => {
            const existing = asActive(read.get(record.id) as Record<string, unknown> | undefined);
            if (existing) return sameSnippet(rowToRecord(existing), record) ? "created" : "conflict";
            if (asTomb(readTomb.get(record.id) as Record<string, unknown> | undefined)) return "conflict";
            insert.run(
              record.id,
              record.ciphertext,
              record.nonce,
              record.salt,
              record.kdf.m,
              record.kdf.t,
              record.kdf.p,
              record.kdf.hashLen,
              record.expiresAt,
              record.burnAfterRead ? 1 : 0,
              record.createdAt,
            );
            return "created";
          }),
        ),
      open: (id, now) =>
        Promise.resolve(
          immediate(db, (): OpenResult => {
            const expired = asActive(expire.get(id, now) as Record<string, unknown> | undefined);
            if (expired) {
              tombstone.run(id, "expired", now + TOMBSTONE_MS);
              return { status: "gone", reason: "expired" };
            }
            const burned = asActive(burn.get(id) as Record<string, unknown> | undefined);
            if (burned) {
              tombstone.run(id, "burned", now + TOMBSTONE_MS);
              return { status: "ok", burned: true, record: rowToRecord(burned) };
            }
            const live = asActive(read.get(id) as Record<string, unknown> | undefined);
            if (live) return { status: "ok", burned: false, record: rowToRecord(live) };
            const tomb = asTomb(readTomb.get(id) as Record<string, unknown> | undefined);
            if (!tomb || tomb.until_ms <= now) {
              if (tomb) deleteTomb.run(id);
              return { status: "gone", reason: "missing" };
            }
            return { status: "gone", reason: asGone(tomb.reason) };
          }),
        ),
    };
    this.rateLimit = {
      consume: (bucket, limit, windowMs, now) =>
        Promise.resolve(
          immediate(db, (): RateDecision | RateRejection => {
            const row = rateGet.get(bucket) as Record<string, unknown> | undefined;
            const count = row ? num(row.count) : 0;
            const windowStart = row ? num(row.window_start) : 0;
            if (!row || now - windowStart >= windowMs) {
              rateUpsert.run(bucket, 1, now);
              return { allowed: true };
            }
            if (count >= limit) {
              return { allowed: false, retryAfterMs: Math.max(1, windowMs - (now - windowStart)) };
            }
            rateInc.run(bucket);
            return { allowed: true };
          }),
        ),
    };
  }

  static open(path: string): SqliteBackend {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path, { timeout: 5000 });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA secure_delete = ON");
    db.exec("PRAGMA foreign_keys = ON");
    return new SqliteBackend(db);
  }

  sweep(now: number): void {
    immediate(this.db, () => {
      const due = this.db.prepare("SELECT id FROM snippets WHERE expires_at <= ?").all(now) as Array<Record<string, unknown>>;
      const expire = this.db.prepare("DELETE FROM snippets WHERE id = ? AND expires_at <= ?");
      const tomb = this.db.prepare(
        `INSERT INTO tombstones (id, reason, until_ms) VALUES (?, 'expired', ?)
         ON CONFLICT(id) DO UPDATE SET reason = 'expired', until_ms = excluded.until_ms`,
      );
      for (const row of due) {
        const id = String(row.id);
        expire.run(id, now);
        tomb.run(id, now + TOMBSTONE_MS);
      }
      this.db.prepare("DELETE FROM tombstones WHERE until_ms <= ?").run(now);
      this.db.prepare("DELETE FROM rate_limits WHERE window_start <= ?").run(now - TOMBSTONE_MS);
    });
  }

  ciphertextStored(id: string): boolean {
    const row = this.db.prepare("SELECT ciphertext FROM snippets WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row !== undefined && String(row.ciphertext).length > 0;
  }

  close(): void {
    this.db.close();
  }
}
