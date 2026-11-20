import { describe, expect, it } from "vitest";
import { encodeAad } from "../../src/shared/aad.js";
import { bytesToHex, hexToBytes } from "../../src/shared/bytes.js";
import { KDF_V1 } from "../../src/shared/protocol.js";

const base = {
  id: "AAAAAAAAAAAAAAAAAAAAAA",
  salt: hexToBytes("000102030405060708090a0b0c0d0e0f"),
  expiresAt: 1_760_000_000_000,
  burnAfterRead: false,
  m: KDF_V1.m,
  t: KDF_V1.t,
  p: KDF_V1.p,
  hashLen: KDF_V1.hashLen,
};

describe("aad", () => {
  it("is stable and changes when metadata changes", () => {
    const first = bytesToHex(encodeAad(base));
    const second = bytesToHex(encodeAad(base));
    expect(first).toBe(second);
    expect(bytesToHex(encodeAad({ ...base, burnAfterRead: true }))).not.toBe(first);
    expect(bytesToHex(encodeAad({ ...base, id: "BBBBBBBBBBBBBBBBBBBBBB" }))).not.toBe(first);
  });
});
