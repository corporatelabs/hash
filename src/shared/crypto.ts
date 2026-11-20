import { argon2id } from "hash-wasm";
import { encodeAad } from "./aad.js";
import { bytesToBase64, randomBytes, utf8, wipe } from "./bytes.js";
import {
  FRAGMENT_BYTES,
  HKDF_INFO,
  isKdfV1,
  KDF_V1,
  MAX_PASSWORD_CHARS,
  MAX_PLAINTEXT_BYTES,
  NONCE_BYTES,
  SALT_BYTES,
  type KdfParams,
} from "./protocol.js";

export class DecryptError extends Error {
  constructor() {
    super("decrypt failed");
    this.name = "DecryptError";
  }
}

export class SealError extends Error {
  constructor(readonly code: "empty" | "too_large" | "password" | "kdf" | "rng") {
    super(code);
    this.name = "SealError";
  }
}

export interface SealInput {
  plaintext: string;
  password: string;
  id: string;
  expiresAt: number;
  burnAfterRead: boolean;
  salt?: Uint8Array;
  nonce?: Uint8Array;
  fragment?: Uint8Array;
  kdf?: KdfParams;
  /** Test-only. The browser and the server both refuse a KDF other than v1. */
  allowWeakKdf?: boolean;
}

export interface Sealed {
  id: string;
  salt: Uint8Array;
  nonce: Uint8Array;
  fragment: Uint8Array;
  ciphertext: Uint8Array;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: KdfParams;
  aad: Uint8Array;
  aesKey: Uint8Array;
}

export interface OpenInput {
  password: string;
  fragment: Uint8Array;
  id: string;
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: KdfParams;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  fragment: Uint8Array,
  kdf: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  const normalized = password.normalize("NFC");
  if (normalized.length === 0 || normalized.length > MAX_PASSWORD_CHARS) {
    throw new SealError("password");
  }
  const argon = await argon2id({
    password: utf8(normalized),
    salt,
    iterations: kdf.t,
    parallelism: kdf.p,
    memorySize: kdf.m,
    hashLength: kdf.hashLen,
    outputType: "binary",
  });
  if (!(argon instanceof Uint8Array)) throw new SealError("kdf");
  const ikm = copyBytes(argon);
  wipe(argon);

  try {
    const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: copyBytes(fragment),
        info: copyBytes(utf8(HKDF_INFO)),
      },
      base,
      256,
    );
    return copyBytes(new Uint8Array(bits));
  } finally {
    wipe(ikm);
  }
}

export async function seal(input: SealInput): Promise<Sealed> {
  const kdf = input.kdf ?? KDF_V1;
  if (!input.allowWeakKdf && !isKdfV1(kdf)) throw new SealError("kdf");
  const plaintext = utf8(input.plaintext);
  if (plaintext.byteLength === 0) throw new SealError("empty");
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) throw new SealError("too_large");

  const salt = input.salt ?? randomBytes(SALT_BYTES);
  const nonce = input.nonce ?? randomBytes(NONCE_BYTES);
  const fragment = input.fragment ?? randomBytes(FRAGMENT_BYTES);
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || fragment.length !== FRAGMENT_BYTES) {
    throw new SealError("rng");
  }

  const aad = encodeAad({
    id: input.id,
    salt,
    expiresAt: input.expiresAt,
    burnAfterRead: input.burnAfterRead,
    m: kdf.m,
    t: kdf.t,
    p: kdf.p,
    hashLen: kdf.hashLen,
  });
  const aesKey = await deriveAesKey(input.password, salt, fragment, kdf);
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", aesKey, { name: "AES-GCM" }, false, ["encrypt"]);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: copyBytes(nonce), additionalData: copyBytes(aad), tagLength: 128 },
        cryptoKey,
        copyBytes(plaintext),
      ),
    );
    return {
      id: input.id,
      salt,
      nonce,
      fragment,
      ciphertext,
      expiresAt: input.expiresAt,
      burnAfterRead: input.burnAfterRead,
      kdf,
      aad,
      aesKey: copyBytes(aesKey),
    };
  } finally {
    wipe(aesKey);
    wipe(plaintext);
  }
}

export async function openSecret(input: OpenInput): Promise<string> {
  // Bound the work a response can request. The UI additionally requires KDF v1.
  if (
    input.kdf.name !== "argon2id" ||
    input.kdf.version !== 1 ||
    input.kdf.p !== 1 ||
    input.kdf.hashLen !== 32 ||
    input.kdf.m < 8 ||
    input.kdf.m > KDF_V1.m ||
    input.kdf.t < 1 ||
    input.kdf.t > KDF_V1.t
  ) {
    throw new SealError("kdf");
  }
  const aad = encodeAad({
    id: input.id,
    salt: input.salt,
    expiresAt: input.expiresAt,
    burnAfterRead: input.burnAfterRead,
    m: input.kdf.m,
    t: input.kdf.t,
    p: input.kdf.p,
    hashLen: input.kdf.hashLen,
  });
  const aesKey = await deriveAesKey(input.password, input.salt, input.fragment, input.kdf);
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", aesKey, { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: copyBytes(input.nonce), additionalData: copyBytes(aad), tagLength: 128 },
      cryptoKey,
      copyBytes(input.ciphertext),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch (error) {
    if (error instanceof SealError) throw error;
    throw new DecryptError();
  } finally {
    wipe(aesKey);
  }
}

export function sealedToJson(sealed: Omit<Sealed, "fragment" | "aad" | "aesKey">): {
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: KdfParams;
} {
  return {
    id: sealed.id,
    ciphertext: bytesToBase64(sealed.ciphertext),
    nonce: bytesToBase64(sealed.nonce),
    salt: bytesToBase64(sealed.salt),
    expiresAt: sealed.expiresAt,
    burnAfterRead: sealed.burnAfterRead,
    kdf: sealed.kdf,
  };
}
