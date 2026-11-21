import type { GoneReason, KdfParams } from "../shared/protocol.js";

/** What the server stores. Never a password, fragment, or plaintext. */
export interface SnippetRecord {
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  kdf: KdfParams;
  expiresAt: number;
  burnAfterRead: boolean;
  createdAt: number;
}

export type OpenResult =
  | { status: "ok"; record: SnippetRecord; burned: boolean }
  | { status: "gone"; reason: GoneReason };

export interface SnippetStore {
  create(record: SnippetRecord): Promise<"created" | "conflict">;
  open(id: string, now: number): Promise<OpenResult>;
}

export interface RateDecision {
  allowed: true;
}

export interface RateRejection {
  allowed: false;
  retryAfterMs: number;
}

export interface RateLimitStore {
  consume(bucket: string, limit: number, windowMs: number, now: number): Promise<RateDecision | RateRejection>;
}

export class StorageUnavailable extends Error {
  constructor() {
    super("storage_unavailable");
    this.name = "StorageUnavailable";
  }
}

export function sameSnippet(left: SnippetRecord, right: SnippetRecord): boolean {
  return (
    left.id === right.id &&
    left.ciphertext === right.ciphertext &&
    left.nonce === right.nonce &&
    left.salt === right.salt &&
    left.expiresAt === right.expiresAt &&
    left.burnAfterRead === right.burnAfterRead &&
    left.kdf.m === right.kdf.m &&
    left.kdf.t === right.kdf.t &&
    left.kdf.p === right.kdf.p &&
    left.kdf.hashLen === right.kdf.hashLen &&
    left.kdf.version === right.kdf.version &&
    left.kdf.name === right.kdf.name
  );
}
