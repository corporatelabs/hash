import { bytesToBase64, bytesToBase64Url, randomBytes } from "../../src/shared/bytes.js";
import { KDF_V1 } from "../../src/shared/protocol.js";
import type { SnippetRecord } from "../../src/core/store.js";

export function sampleRecord(now: number, patch: Partial<SnippetRecord> = {}): SnippetRecord {
  return {
    id: bytesToBase64Url(randomBytes(16)),
    ciphertext: bytesToBase64(randomBytes(32)),
    nonce: bytesToBase64(randomBytes(12)),
    salt: bytesToBase64(randomBytes(16)),
    kdf: { ...KDF_V1 },
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    burnAfterRead: false,
    createdAt: now,
    ...patch,
  };
}

export function createBody(record: SnippetRecord): Record<string, unknown> {
  return {
    id: record.id,
    ciphertext: record.ciphertext,
    nonce: record.nonce,
    salt: record.salt,
    expiresAt: record.expiresAt,
    burnAfterRead: record.burnAfterRead,
    kdf: record.kdf,
  };
}
