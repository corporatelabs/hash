import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
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

/**
 * SQLite store. Burn and expiry both use `DELETE ... RETURNING` inside an
 * IMMEDIATE transaction, so a concurrent opener cannot observe the ciphertext
 * after the winning statement.
 */
type SqliteHandle = InstanceType<typeof Database>;

export class SqliteBackend {
  readonly snippets: SnippetStore;
  readonly rateLimit: RateLimitStore;
  private readonly db: SqliteHandle;

  private constructor(db: SqliteHandle) {
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

    const read = db.prepare<[string], ActiveRow>("SELECT * FROM snippets WHERE id = ?");
    const expire = db.prepare<[string, number], ActiveRow>(
      "DELETE FROM snippets WHERE id = ? AND expires_at <= ? RETURNING *",
    );
    const burn = db.prepare<[string], ActiveRow>(
      "DELETE FROM snippets WHERE id = ? AND burn_after_read = 1 RETURNING *",
    );
    const tombstone = db.prepare(
      `INSERT INTO tombstones (id, reason, until_ms) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET reason = excluded.reason, until_ms = excluded.until_ms`,
    );
    const readTomb = db.prepare<[string], TombRow>("SELECT id, reason, until_ms FROM tombstones WHERE id = ?");
    const deleteTomb = db.prepare("DELETE FROM tombstones WHERE id = ?");
    const insert = db.prepare(
      `INSERT INTO snippets (
        id, ciphertext, nonce, salt, kdf_m, kdf_t, kdf_p, kdf_hash_len, expires_at, burn_after_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const openTx = db.transaction((id: string, now: number): OpenResult => {
      const expired = expire.get(id, now);
      if (expired) {
        tombstone.run(id, "expired", now + TOMBSTONE_MS);
        return { status: "gone", reason: "expired" };
      }
      const burned = burn.get(id);
      if (burned) {
        tombstone.run(id, "burned", now + TOMBSTONE_MS);
        return { status: "ok", burned: true, record: rowToRecord(burned) };
      }
      const live = read.get(id);
      if (live) return { status: "ok", burned: false, record: rowToRecord(live) };
      const tomb = readTomb.get(id);
      if (!tomb || tomb.until_ms <= now) {
        if (tomb) deleteTomb.run(id);
        return { status: "gone", reason: "missing" };
      }
      return { status: "gone", reason: asGone(tomb.reason) };
    });

    const createTx = db.transaction((record: SnippetRecord): "created" | "conflict" => {
      const existing = read.get(record.id);
      if (existing) return sameSnippet(rowToRecord(existing), record) ? "created" : "conflict";
      if (readTomb.get(record.id)) return "conflict";
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
    });

    const rateGet = db.prepare<[string], { count: number; window_start: number }>(
      "SELECT count, window_start FROM rate_limits WHERE bucket = ?",
    );
    const rateUpsert = db.prepare(
      `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, ?, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`,
    );
    const rateInc = db.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?");
    const rateTx = db.transaction((bucket: string, limit: number, windowMs: number, now: number): RateDecision | RateRejection => {
      const row = rateGet.get(bucket);
      if (!row || now - row.window_start >= windowMs) {
        rateUpsert.run(bucket, 1, now);
        return { allowed: true };
      }
      if (row.count >= limit) {
        return { allowed: false, retryAfterMs: Math.max(1, windowMs - (now - row.window_start)) };
      }
      rateInc.run(bucket);
      return { allowed: true };
    });

    this.snippets = {
      create: (record) => Promise.resolve(createTx.immediate(record)),
      open: (id, now) => Promise.resolve(openTx.immediate(id, now)),
    };
    this.rateLimit = {
      consume: (bucket, limit, windowMs, now) => Promise.resolve(rateTx.immediate(bucket, limit, windowMs, now)),
    };
  }

  static open(path: string): SqliteBackend {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { timeout: 5000 });
    db.pragma("journal_mode = WAL");
    db.pragma("secure_delete = ON");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    return new SqliteBackend(db);
  }

  sweep(now: number): void {
    const sweepTx = this.db.transaction(() => {
      const due = this.db.prepare<[number], { id: string }>("SELECT id FROM snippets WHERE expires_at <= ?").all(now);
      const expire = this.db.prepare("DELETE FROM snippets WHERE id = ? AND expires_at <= ?");
      const tomb = this.db.prepare(
        `INSERT INTO tombstones (id, reason, until_ms) VALUES (?, 'expired', ?)
         ON CONFLICT(id) DO UPDATE SET reason = 'expired', until_ms = excluded.until_ms`,
      );
      for (const row of due) {
        expire.run(row.id, now);
        tomb.run(row.id, now + TOMBSTONE_MS);
      }
      this.db.prepare("DELETE FROM tombstones WHERE until_ms <= ?").run(now);
      this.db.prepare("DELETE FROM rate_limits WHERE window_start <= ?").run(now - TOMBSTONE_MS);
    });
    sweepTx.immediate();
  }

  /** Test aid: ciphertext column is gone after a burn or expiry. */
  ciphertextStored(id: string): boolean {
    const row = this.db.prepare<[string], { ciphertext: string }>("SELECT ciphertext FROM snippets WHERE id = ?").get(id);
    return row !== undefined && row.ciphertext.length > 0;
  }

  close(): void {
    this.db.close();
  }
}
