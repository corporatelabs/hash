import { DurableObject } from "cloudflare:workers";
import { TOMBSTONE_MS, type GoneReason, type KdfParams } from "../../shared/protocol.js";
import { sameSnippet, type OpenResult, type SnippetRecord } from "../../core/store.js";

interface ActiveRow {
  [key: string]: SqlStorageValue;
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
  [key: string]: SqlStorageValue;
  id: string;
  reason: string;
  until_ms: number;
}

function recordFrom(row: ActiveRow): SnippetRecord {
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

export class SnippetObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
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
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS tombstones (
          id TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          until_ms INTEGER NOT NULL
        )
      `);
    });
  }

  async create(record: SnippetRecord): Promise<"created" | "conflict"> {
    const result = this.ctx.storage.transactionSync((): "created" | "conflict" => {
      const existing = this.ctx.storage.sql
        .exec<ActiveRow>("SELECT * FROM snippets WHERE id = ?", record.id)
        .toArray()[0];
      if (existing) return sameSnippet(recordFrom(existing), record) ? "created" : "conflict";
      const tomb = this.ctx.storage.sql
        .exec<TombRow>("SELECT id, reason, until_ms FROM tombstones WHERE id = ?", record.id)
        .toArray()[0];
      if (tomb) return "conflict";
      this.ctx.storage.sql.exec(
        `INSERT INTO snippets (
          id, ciphertext, nonce, salt, kdf_m, kdf_t, kdf_p, kdf_hash_len, expires_at, burn_after_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    if (result === "created") await this.ctx.storage.setAlarm(record.expiresAt);
    return result;
  }

  async open(now: number): Promise<OpenResult> {
    return this.ctx.storage.transactionSync((): OpenResult => {
      const expired = this.ctx.storage.sql
        .exec<ActiveRow>("DELETE FROM snippets WHERE expires_at <= ? RETURNING *", now)
        .toArray()[0];
      if (expired) {
        this.writeTomb(expired.id, "expired", now + TOMBSTONE_MS);
        return { status: "gone", reason: "expired" };
      }
      const burned = this.ctx.storage.sql
        .exec<ActiveRow>("DELETE FROM snippets WHERE burn_after_read = 1 RETURNING *")
        .toArray()[0];
      if (burned) {
        this.writeTomb(burned.id, "burned", now + TOMBSTONE_MS);
        return { status: "ok", burned: true, record: recordFrom(burned) };
      }
      const live = this.ctx.storage.sql.exec<ActiveRow>("SELECT * FROM snippets").toArray()[0];
      if (live) return { status: "ok", burned: false, record: recordFrom(live) };
      const tomb = this.ctx.storage.sql.exec<TombRow>("SELECT id, reason, until_ms FROM tombstones").toArray()[0];
      if (!tomb || tomb.until_ms <= now) {
        if (tomb) this.ctx.storage.sql.exec("DELETE FROM tombstones WHERE id = ?", tomb.id);
        return { status: "gone", reason: "missing" };
      }
      return { status: "gone", reason: asGone(tomb.reason) };
    });
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const next = this.ctx.storage.transactionSync((): number | null => {
      const active = this.ctx.storage.sql.exec<ActiveRow>("SELECT * FROM snippets").toArray()[0];
      if (active) {
        if (active.expires_at <= now) {
          this.ctx.storage.sql.exec("DELETE FROM snippets WHERE id = ?", active.id);
          this.writeTomb(active.id, "expired", now + TOMBSTONE_MS);
          return now + TOMBSTONE_MS;
        }
        return active.expires_at;
      }
      const tomb = this.ctx.storage.sql.exec<TombRow>("SELECT id, reason, until_ms FROM tombstones").toArray()[0];
      if (!tomb) return null;
      if (tomb.until_ms <= now) {
        this.ctx.storage.sql.exec("DELETE FROM tombstones WHERE id = ?", tomb.id);
        return null;
      }
      return tomb.until_ms;
    });
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  private writeTomb(id: string, reason: GoneReason, until: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO tombstones (id, reason, until_ms) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET reason = excluded.reason, until_ms = excluded.until_ms`,
      id,
      reason,
      until,
    );
  }
}
