import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "../../src/shared/bytes.js";
import { DecryptError, openSecret, seal } from "../../src/shared/crypto.js";
import { KDF_V1, type KdfParams } from "../../src/shared/protocol.js";

interface Vector {
  password: string;
  plaintext: string;
  id: string;
  expiresAt: number;
  burnAfterRead: boolean;
  saltHex: string;
  nonceHex: string;
  fragmentHex: string;
  aesKeyHex: string;
  aadHex: string;
  ciphertextHex: string;
}

const vector = JSON.parse(readFileSync(new URL("../fixtures/envelope-v1.json", import.meta.url), "utf8")) as Vector;
const FAST: KdfParams = { name: "argon2id", version: 1, m: 64, t: 1, p: 1, hashLen: 32 };

describe("envelope v1", () => {
  it("matches the pinned production vector and rejects a wrong password or a tampered byte", async () => {
    const salt = hexToBytes(vector.saltHex);
    const nonce = hexToBytes(vector.nonceHex);
    const fragment = hexToBytes(vector.fragmentHex);
    const sealed = await seal({
      password: vector.password,
      plaintext: vector.plaintext,
      id: vector.id,
      expiresAt: vector.expiresAt,
      burnAfterRead: vector.burnAfterRead,
      salt,
      nonce,
      fragment,
    });
    expect(bytesToHex(sealed.aesKey)).toBe(vector.aesKeyHex);
    expect(bytesToHex(sealed.aad)).toBe(vector.aadHex);
    expect(bytesToHex(sealed.ciphertext)).toBe(vector.ciphertextHex);
    const opened = await openSecret({
      password: vector.password,
      fragment,
      id: vector.id,
      salt,
      nonce,
      ciphertext: sealed.ciphertext,
      expiresAt: vector.expiresAt,
      burnAfterRead: false,
      kdf: KDF_V1,
    });
    expect(opened).toBe(vector.plaintext);
    const wrong = openSecret({
      password: `${vector.password}-no`,
      fragment,
      id: vector.id,
      salt,
      nonce,
      ciphertext: sealed.ciphertext,
      expiresAt: vector.expiresAt,
      burnAfterRead: false,
      kdf: KDF_V1,
    });
    await expect(wrong).rejects.toBeInstanceOf(DecryptError);
    const flipped = new Uint8Array(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    await expect(
      openSecret({
        password: vector.password,
        fragment,
        id: vector.id,
        salt,
        nonce,
        ciphertext: flipped,
        expiresAt: vector.expiresAt,
        burnAfterRead: false,
        kdf: KDF_V1,
      }),
    ).rejects.toBeInstanceOf(DecryptError);
    await expect(
      openSecret({
        password: vector.password,
        fragment,
        id: vector.id,
        salt,
        nonce,
        ciphertext: sealed.ciphertext,
        expiresAt: vector.expiresAt + 1,
        burnAfterRead: false,
        kdf: KDF_V1,
      }),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it("normalizes the password and refuses a non-v1 kdf unless a test asks", async () => {
    await expect(
      seal({
        password: "correct horse battery",
        plaintext: "x",
        id: vector.id,
        expiresAt: vector.expiresAt,
        burnAfterRead: false,
        kdf: FAST,
      }),
    ).rejects.toThrow(/kdf/);
    const composed = "cafe\u0301";
    const precomposed = "caf\u00e9";
    const left = await seal({
      password: composed,
      plaintext: "same",
      id: vector.id,
      expiresAt: vector.expiresAt,
      burnAfterRead: false,
      salt: hexToBytes(vector.saltHex),
      nonce: hexToBytes(vector.nonceHex),
      fragment: hexToBytes(vector.fragmentHex),
      kdf: FAST,
      allowWeakKdf: true,
    });
    const right = await seal({
      password: precomposed,
      plaintext: "same",
      id: vector.id,
      expiresAt: vector.expiresAt,
      burnAfterRead: true,
      salt: hexToBytes(vector.saltHex),
      nonce: hexToBytes(vector.nonceHex),
      fragment: hexToBytes(vector.fragmentHex),
      kdf: FAST,
      allowWeakKdf: true,
    });
    expect(bytesToHex(left.aesKey)).toBe(bytesToHex(right.aesKey));
    expect(bytesToHex(left.ciphertext)).not.toBe(bytesToHex(right.ciphertext));
  });
});
