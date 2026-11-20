import { Redis } from "ioredis";
import { TOMBSTONE_MS, type GoneReason, type KdfParams } from "../shared/protocol.js";
import {
  sameSnippet,
  StorageUnavailable,
  type OpenResult,
  type RateDecision,
  type RateLimitStore,
  type RateRejection,
  type SnippetRecord,
  type SnippetStore,
} from "../core/store.js";

const OPEN_LUA = `
local now = tonumber(ARGV[1])
local tombTtl = tonumber(ARGV[2])
local id = ARGV[3]
local raw = redis.call('GET', KEYS[1])
if raw then
  local ok, data = pcall(cjson.decode, raw)
  if not ok or type(data) ~= 'table' or data.expiresAt == nil then
    redis.call('DEL', KEYS[1])
    redis.call('ZREM', KEYS[3], id)
    return {'missing'}
  end
  if tonumber(data.expiresAt) <= now then
    redis.call('DEL', KEYS[1])
    redis.call('SET', KEYS[2], 'expired', 'PX', tombTtl)
    redis.call('ZREM', KEYS[3], id)
    return {'expired'}
  end
  if data.burnAfterRead == true or data.burnAfterRead == 1 then
    redis.call('DEL', KEYS[1])
    redis.call('SET', KEYS[2], 'burned', 'PX', tombTtl)
    redis.call('ZREM', KEYS[3], id)
    return {'ok', raw}
  end
  return {'ok', raw}
end
local tomb = redis.call('GET', KEYS[2])
if tomb == 'expired' or tomb == 'burned' then
  return {'gone', tomb}
end
return {'missing'}
`;

const CREATE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return 'created'
  end
  return 'conflict'
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 'conflict'
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[4])
return 'created'
`;

const RATE_LUA = `
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], window)
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], window)
  ttl = window
end
if current > limit then
  return {0, ttl}
end
return {1, ttl}
`;

const EXPIRE_LUA = `
local now = tonumber(ARGV[1])
local tombTtl = tonumber(ARGV[2])
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[3], ARGV[3])
  return 0
end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or tonumber(data.expiresAt) <= now then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], 'expired', 'PX', tombTtl)
  redis.call('ZREM', KEYS[3], ARGV[3])
  return 1
end
return 0
`;

function payload(record: SnippetRecord): string {
  return JSON.stringify({
    id: record.id,
    ciphertext: record.ciphertext,
    nonce: record.nonce,
    salt: record.salt,
    kdf: {
      name: record.kdf.name,
      version: record.kdf.version,
      m: record.kdf.m,
      t: record.kdf.t,
      p: record.kdf.p,
      hashLen: record.kdf.hashLen,
    },
    expiresAt: record.expiresAt,
    burnAfterRead: record.burnAfterRead,
    createdAt: record.createdAt,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(raw: string): SnippetRecord | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !isRecord(value.kdf)) return null;
    if (typeof value.id !== "string" || typeof value.ciphertext !== "string") return null;
    if (typeof value.nonce !== "string" || typeof value.salt !== "string") return null;
    if (typeof value.expiresAt !== "number" || typeof value.burnAfterRead !== "boolean") return null;
    if (typeof value.createdAt !== "number") return null;
    const kdf = value.kdf;
    if (kdf.name !== "argon2id" || kdf.version !== 1) return null;
    if (typeof kdf.m !== "number" || typeof kdf.t !== "number" || typeof kdf.p !== "number" || typeof kdf.hashLen !== "number") {
      return null;
    }
    const params: KdfParams = { name: "argon2id", version: 1, m: kdf.m, t: kdf.t, p: kdf.p, hashLen: kdf.hashLen };
    return {
      id: value.id,
      ciphertext: value.ciphertext,
      nonce: value.nonce,
      salt: value.salt,
      kdf: params,
      expiresAt: value.expiresAt,
      burnAfterRead: value.burnAfterRead,
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

function asGone(reason: unknown): GoneReason {
  return reason === "expired" || reason === "burned" ? reason : "missing";
}

function unavailable(error: unknown): never {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "ECONNREFUSED" || code === "NR_CLOSED" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
    throw new StorageUnavailable();
  }
  throw error instanceof Error ? error : new StorageUnavailable();
}

export class RedisBackend {
  readonly snippets: SnippetStore;
  readonly rateLimit: RateLimitStore;

  constructor(
    private readonly redis: Redis,
    private readonly prefix = "hash:v1",
  ) {
    this.snippets = {
      create: (record) => this.create(record),
      open: (id, now) => this.open(id, now),
    };
    this.rateLimit = {
      consume: (bucket, limit, windowMs, now) => this.consume(bucket, limit, windowMs, now),
    };
  }

  static async connect(url: string, prefix = "hash:v1"): Promise<RedisBackend> {
    const redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 2_000,
      lazyConnect: true,
    });
    try {
      await redis.connect();
      await redis.ping();
    } catch (error) {
      redis.disconnect();
      unavailable(error);
    }
    return new RedisBackend(redis, prefix);
  }

  private dataKey(id: string): string {
    return `${this.prefix}:snippet:${id}`;
  }

  private tombKey(id: string): string {
    return `${this.prefix}:tomb:${id}`;
  }

  private expiryKey(): string {
    return `${this.prefix}:expiry`;
  }

  private async create(record: SnippetRecord): Promise<"created" | "conflict"> {
    const now = Date.now();
    const ttl = Math.max(TOMBSTONE_MS, record.expiresAt - now + TOMBSTONE_MS);
    try {
      const result = await this.redis.eval(
        CREATE_LUA,
        3,
        this.dataKey(record.id),
        this.tombKey(record.id),
        this.expiryKey(),
        payload(record),
        String(ttl),
        String(record.expiresAt),
        record.id,
      );
      if (result !== "created" && result !== "conflict") throw new Error("redis create");
      if (result === "created") return "created";
      const current = await this.redis.get(this.dataKey(record.id));
      if (current) {
        const parsed = parseRecord(current);
        if (parsed && sameSnippet(parsed, record)) return "created";
      }
      return "conflict";
    } catch (error) {
      unavailable(error);
    }
  }

  private async open(id: string, now: number): Promise<OpenResult> {
    try {
      const result = await this.redis.eval(
        OPEN_LUA,
        3,
        this.dataKey(id),
        this.tombKey(id),
        this.expiryKey(),
        String(now),
        String(TOMBSTONE_MS),
        id,
      );
      if (!Array.isArray(result) || result.length === 0) return { status: "gone", reason: "missing" };
      const kind = result[0];
      if (kind === "expired") return { status: "gone", reason: "expired" };
      if (kind === "missing") return { status: "gone", reason: "missing" };
      if (kind === "gone") return { status: "gone", reason: asGone(result[1]) };
      if (kind === "ok" && typeof result[1] === "string") {
        const record = parseRecord(result[1]);
        if (!record) return { status: "gone", reason: "missing" };
        return { status: "ok", record, burned: record.burnAfterRead };
      }
      return { status: "gone", reason: "missing" };
    } catch (error) {
      unavailable(error);
    }
  }

  private async consume(bucket: string, limit: number, windowMs: number, _now: number): Promise<RateDecision | RateRejection> {
    try {
      const result = await this.redis.eval(RATE_LUA, 1, `${this.prefix}:rate:${bucket}`, String(limit), String(windowMs));
      if (!Array.isArray(result) || result.length < 2) throw new Error("redis rate");
      const allowed = Number(result[0]) === 1;
      const ttl = Number(result[1]);
      if (allowed) return { allowed: true };
      return { allowed: false, retryAfterMs: Math.max(1, ttl) };
    } catch (error) {
      unavailable(error);
    }
  }

  async sweep(now: number): Promise<void> {
    try {
      const ids = await this.redis.zrangebyscore(this.expiryKey(), 0, now);
      for (const id of ids) {
        await this.redis.eval(
          EXPIRE_LUA,
          3,
          this.dataKey(id),
          this.tombKey(id),
          this.expiryKey(),
          String(now),
          String(TOMBSTONE_MS),
          id,
        );
      }
    } catch (error) {
      unavailable(error);
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
