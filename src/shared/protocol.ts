/**
 * Protocol constants shared by the browser, the API, and the storage adapters.
 * Changing any KDF, HKDF, or AAD value is a new envelope version.
 */

export const PROTOCOL_VERSION = 1 as const;

export const KDF_V1 = Object.freeze({
  name: "argon2id" as const,
  version: 1 as const,
  /** KiB. 65_536 KiB = 64 MiB. RFC 9106's second recommended memory cost. */
  m: 65_536,
  /** Iterations. */
  t: 3,
  /**
   * Lanes. RFC 9106's second option uses p=4. v1 uses p=1 because the
   * browser WASM build is single-threaded; extra lanes would not add
   * parallelism and would raise the memory floor.
   */
  p: 1,
  hashLen: 32 as const,
});

export type KdfParams = {
  readonly name: "argon2id";
  readonly version: 1;
  readonly m: number;
  readonly t: number;
  readonly p: number;
  readonly hashLen: number;
};

export const HKDF_INFO = "hash-v1-aes-256-gcm";

export const ID_BYTES = 16;
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const FRAGMENT_BYTES = 32;
export const GCM_TAG_BYTES = 16;
export const MAX_PLAINTEXT_BYTES = 64 * 1024;
export const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + GCM_TAG_BYTES;
export const MAX_REQUEST_BYTES = 128 * 1024;
export const MAX_PASSWORD_CHARS = 1024;

export const EXPIRY_SKEW_MS = 2 * 60 * 1000;
export const TOMBSTONE_MS = 24 * 60 * 60 * 1000;

export const EXPIRY_PRESETS = [
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "1d", label: "1 day", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

export type ExpiryPresetId = (typeof EXPIRY_PRESETS)[number]["id"];
export const DEFAULT_EXPIRY: ExpiryPresetId = "7d";

export const RATE_LIMITS = {
  create: { limit: 10, windowMs: 10 * 60 * 1000 },
  open: { limit: 30, windowMs: 10 * 60 * 1000 },
} as const;

export type RateAction = keyof typeof RATE_LIMITS;

/** Public placeholder. Production refuses to create secrets while this is set. */
export const DEV_PEPPER = "development-only-pepper";

export const HOSTED_ORIGIN = "https://hash.corporatelabs.ai";

export type HashEnvironment = "production" | "development" | "test";

export type GoneReason = "missing" | "expired" | "burned";

export function isKdfV1(value: KdfParams): boolean {
  return (
    value.name === KDF_V1.name &&
    value.version === KDF_V1.version &&
    value.m === KDF_V1.m &&
    value.t === KDF_V1.t &&
    value.p === KDF_V1.p &&
    value.hashLen === KDF_V1.hashLen
  );
}

export function parseEnvironment(value: string | undefined): HashEnvironment {
  if (value === "production" || value === "development" || value === "test") return value;
  throw new Error("ENVIRONMENT must be production, development, or test");
}

export function presetMs(id: ExpiryPresetId): number {
  const preset = EXPIRY_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error("unknown expiry");
  return preset.ms;
}
