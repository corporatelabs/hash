import { DurableObject } from "cloudflare:workers";
import type { RateDecision, RateRejection } from "../../core/store.js";

/** One object per hashed client bucket. The bucket name is not an IP address. */
export class RateLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS window (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          count INTEGER NOT NULL,
          window_start INTEGER NOT NULL
        )
      `);
    });
  }

  async consume(limit: number, windowMs: number, now: number): Promise<RateDecision | RateRejection> {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<{ count: number; window_start: number }>("SELECT count, window_start FROM window WHERE id = 1")
        .toArray()[0];
      if (!row || now - row.window_start >= windowMs) {
        this.ctx.storage.sql.exec(
          `INSERT INTO window (id, count, window_start) VALUES (1, 1, ?)
           ON CONFLICT(id) DO UPDATE SET count = 1, window_start = excluded.window_start`,
          now,
        );
        return { allowed: true };
      }
      if (row.count >= limit) {
        return { allowed: false, retryAfterMs: Math.max(1, windowMs - (now - row.window_start)) };
      }
      this.ctx.storage.sql.exec("UPDATE window SET count = count + 1 WHERE id = 1");
      return { allowed: true };
    });
  }
}
