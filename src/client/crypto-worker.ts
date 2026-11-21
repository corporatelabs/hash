import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url } from "../shared/bytes.js";
import { DecryptError, SealError, openSecret, seal } from "../shared/crypto.js";
import { FRAGMENT_BYTES, KDF_V1, NONCE_BYTES, SALT_BYTES, isKdfV1, type KdfParams } from "../shared/protocol.js";

interface Envelope {
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: KdfParams;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readEnvelope(value: unknown): Envelope | null {
  if (!isRecord(value) || !isRecord(value.kdf)) return null;
  const kdf = value.kdf;
  if (
    typeof value.id !== "string" ||
    typeof value.ciphertext !== "string" ||
    typeof value.nonce !== "string" ||
    typeof value.salt !== "string" ||
    typeof value.expiresAt !== "number" ||
    typeof value.burnAfterRead !== "boolean" ||
    kdf.name !== "argon2id" ||
    kdf.version !== 1 ||
    typeof kdf.m !== "number" ||
    typeof kdf.t !== "number" ||
    typeof kdf.p !== "number" ||
    typeof kdf.hashLen !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    ciphertext: value.ciphertext,
    nonce: value.nonce,
    salt: value.salt,
    expiresAt: value.expiresAt,
    burnAfterRead: value.burnAfterRead,
    kdf: { name: "argon2id", version: 1, m: kdf.m, t: kdf.t, p: kdf.p, hashLen: kdf.hashLen },
  };
}

function post(message: unknown): void {
  self.postMessage(message);
}

async function onSeal(id: number, data: Record<string, unknown>): Promise<void> {
  if (typeof data.plaintext !== "string" || typeof data.password !== "string" || typeof data.snippetId !== "string") {
    post({ id, ok: false, error: "invalid" });
    return;
  }
  if (typeof data.expiresAt !== "number" || typeof data.burnAfterRead !== "boolean") {
    post({ id, ok: false, error: "invalid" });
    return;
  }
  try {
    const sealed = await seal({
      plaintext: data.plaintext,
      password: data.password,
      id: data.snippetId,
      expiresAt: data.expiresAt,
      burnAfterRead: data.burnAfterRead,
      onProgress: (stage) => post({ id, progress: stage }),
    });
    post({
      id,
      ok: true,
      result: {
        fragment: bytesToBase64Url(sealed.fragment),
        id: sealed.id,
        ciphertext: bytesToBase64(sealed.ciphertext),
        nonce: bytesToBase64(sealed.nonce),
        salt: bytesToBase64(sealed.salt),
        expiresAt: sealed.expiresAt,
        burnAfterRead: sealed.burnAfterRead,
        kdf: sealed.kdf,
      },
    });
  } catch (error) {
    post({ id, ok: false, error: error instanceof SealError ? error.code : "invalid" });
  }
}

async function onOpen(id: number, data: Record<string, unknown>): Promise<void> {
  if (typeof data.password !== "string" || typeof data.fragment !== "string" || !isRecord(data.envelope)) {
    post({ id, ok: false, error: "invalid" });
    return;
  }
  const envelope = readEnvelope(data.envelope);
  if (!envelope || !isKdfV1(envelope.kdf)) {
    post({ id, ok: false, error: "kdf" });
    return;
  }
  const fragment = base64UrlToBytes(data.fragment, FRAGMENT_BYTES);
  const salt = typeof envelope.salt === "string" ? base64ToBytes(envelope.salt) : null;
  const nonce = typeof envelope.nonce === "string" ? base64ToBytes(envelope.nonce) : null;
  const ciphertext = typeof envelope.ciphertext === "string" ? base64ToBytes(envelope.ciphertext) : null;
  if (!fragment || !salt || !nonce || !ciphertext || salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES) {
    post({ id, ok: false, error: "invalid" });
    return;
  }
  try {
    const plaintext = await openSecret({
      password: data.password,
      fragment,
      id: envelope.id,
      salt,
      nonce,
      ciphertext,
      expiresAt: envelope.expiresAt,
      burnAfterRead: envelope.burnAfterRead,
      kdf: KDF_V1,
      onProgress: (stage) => post({ id, progress: stage }),
    });
    post({ id, ok: true, result: { plaintext } });
  } catch (error) {
    post({ id, ok: false, error: error instanceof DecryptError ? "decrypt" : "invalid" });
  }
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (!isRecord(data) || typeof data.id !== "number" || (data.op !== "seal" && data.op !== "open")) return;
  const run = data.op === "seal" ? onSeal(data.id, data) : onOpen(data.id, data);
  run.catch(() => post({ id: data.id, ok: false, error: "invalid" }));
};
