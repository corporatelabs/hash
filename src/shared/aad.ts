import { PROTOCOL_VERSION } from "./protocol.js";
import { utf8 } from "./bytes.js";

const MAGIC = utf8("HASH1");

export interface AadFields {
  id: string;
  salt: Uint8Array;
  expiresAt: number;
  burnAfterRead: boolean;
  m: number;
  t: number;
  p: number;
  hashLen: number;
}

/**
 * Length-prefixed canonical AAD. Binds the snippet id, salt, expiry, burn
 * flag, and KDF parameters into AES-GCM so a stored record cannot be swapped
 * or have its metadata rewritten without breaking decryption.
 */
export function encodeAad(fields: AadFields): Uint8Array {
  const id = utf8(fields.id);
  if (id.length === 0 || id.length > 255) throw new Error("bad id");
  if (fields.salt.length === 0 || fields.salt.length > 255) throw new Error("bad salt");
  if (!Number.isSafeInteger(fields.expiresAt) || fields.expiresAt < 0) throw new Error("bad expiry");
  for (const n of [fields.m, fields.t, fields.p, fields.hashLen]) {
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) throw new Error("bad kdf");
  }

  const out = new Uint8Array(MAGIC.length + 1 + 1 + id.length + 1 + fields.salt.length + 8 + 1 + 16);
  const view = new DataView(out.buffer);
  let offset = 0;
  out.set(MAGIC, offset);
  offset += MAGIC.length;
  out[offset] = PROTOCOL_VERSION;
  offset += 1;
  out[offset] = id.length;
  offset += 1;
  out.set(id, offset);
  offset += id.length;
  out[offset] = fields.salt.length;
  offset += 1;
  out.set(fields.salt, offset);
  offset += fields.salt.length;
  const hi = Math.floor(fields.expiresAt / 2 ** 32);
  const lo = fields.expiresAt - hi * 2 ** 32;
  view.setUint32(offset, hi, false);
  offset += 4;
  view.setUint32(offset, lo, false);
  offset += 4;
  out[offset] = fields.burnAfterRead ? 1 : 0;
  offset += 1;
  view.setUint32(offset, fields.m, false);
  offset += 4;
  view.setUint32(offset, fields.t, false);
  offset += 4;
  view.setUint32(offset, fields.p, false);
  offset += 4;
  view.setUint32(offset, fields.hashLen, false);
  return out;
}
