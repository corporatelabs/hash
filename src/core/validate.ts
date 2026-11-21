import { base64ToBytes } from "../shared/bytes.js";
import { isValidId } from "../shared/link.js";
import {
  EXPIRY_PRESETS,
  EXPIRY_SKEW_MS,
  GCM_TAG_BYTES,
  isKdfV1,
  KDF_V1,
  MAX_CIPHERTEXT_BYTES,
  NONCE_BYTES,
  SALT_BYTES,
  type HashEnvironment,
  type KdfParams,
} from "../shared/protocol.js";

export interface CreatePayload {
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: KdfParams;
}

export type ParseFailure = { ok: false; status: number; error: string; field?: string };
export type ParseSuccess = { ok: true; value: CreatePayload };
export type ParseResult = ParseFailure | ParseSuccess;

const CREATE_KEYS = ["id", "ciphertext", "nonce", "salt", "expiresAt", "burnAfterRead", "kdf"] as const;
const KDF_KEYS = ["name", "version", "m", "t", "p", "hashLen"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  if (present.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function fail(status: number, error: string, field?: string): ParseFailure {
  return field === undefined ? { ok: false, status, error } : { ok: false, status, error, field };
}

export function expiryAllowed(expiresAt: number, now: number, environment: HashEnvironment): boolean {
  if (!Number.isSafeInteger(expiresAt)) return false;
  if (environment === "test") {
    const min = now - 24 * 60 * 60 * 1000;
    const max = now + 30 * 24 * 60 * 60 * 1000 + EXPIRY_SKEW_MS;
    return expiresAt >= min && expiresAt <= max;
  }
  return EXPIRY_PRESETS.some((preset) => Math.abs(expiresAt - (now + preset.ms)) <= EXPIRY_SKEW_MS);
}

export function parseCreateBody(input: unknown, now: number, environment: HashEnvironment): ParseResult {
  if (!isRecord(input) || !exactKeys(input, CREATE_KEYS)) return fail(400, "invalid", "body");
  if (typeof input.id !== "string" || !isValidId(input.id)) return fail(400, "invalid", "id");
  if (typeof input.ciphertext !== "string") return fail(400, "invalid", "ciphertext");
  if (typeof input.nonce !== "string") return fail(400, "invalid", "nonce");
  if (typeof input.salt !== "string") return fail(400, "invalid", "salt");
  if (typeof input.burnAfterRead !== "boolean") return fail(400, "invalid", "burnAfterRead");
  const expiresAt = input.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) return fail(400, "invalid", "expiresAt");
  if (!isRecord(input.kdf) || !exactKeys(input.kdf, KDF_KEYS)) return fail(400, "invalid", "kdf");

  const kdf = input.kdf;
  if (kdf.name !== "argon2id" || kdf.version !== 1) return fail(400, "invalid", "kdf");
  if (kdf.m !== KDF_V1.m || kdf.t !== KDF_V1.t || kdf.p !== KDF_V1.p || kdf.hashLen !== KDF_V1.hashLen) {
    return fail(400, "invalid", "kdf");
  }
  const params: KdfParams = {
    name: "argon2id",
    version: 1,
    m: KDF_V1.m,
    t: KDF_V1.t,
    p: KDF_V1.p,
    hashLen: KDF_V1.hashLen,
  };
  if (!isKdfV1(params)) return fail(400, "invalid", "kdf");

  const ciphertext = base64ToBytes(input.ciphertext);
  const nonce = base64ToBytes(input.nonce);
  const salt = base64ToBytes(input.salt);
  if (!ciphertext || ciphertext.length < GCM_TAG_BYTES + 1 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    return fail(400, "invalid", "ciphertext");
  }
  if (!nonce || nonce.length !== NONCE_BYTES) return fail(400, "invalid", "nonce");
  if (!salt || salt.length !== SALT_BYTES) return fail(400, "invalid", "salt");
  if (!expiryAllowed(expiresAt, now, environment)) return fail(400, "clock_skew", "expiresAt");

  return {
    ok: true,
    value: {
      id: input.id,
      ciphertext: input.ciphertext,
      nonce: input.nonce,
      salt: input.salt,
      expiresAt,
      burnAfterRead: input.burnAfterRead,
      kdf: params,
    },
  };
}
