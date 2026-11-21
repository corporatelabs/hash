import { base64UrlToBytes, bytesToBase64Url } from "./bytes.js";
import { FRAGMENT_BYTES, ID_BYTES } from "./protocol.js";

export function isValidId(id: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(id) && base64UrlToBytes(id, ID_BYTES) !== null;
}

export function fragmentToken(fragment: Uint8Array): string {
  if (fragment.length !== FRAGMENT_BYTES) throw new Error("bad fragment");
  return `k=${bytesToBase64Url(fragment)}`;
}

/** Path plus fragment. The fragment is never sent to the server. */
export function sharePath(id: string, fragment: Uint8Array): string {
  if (!isValidId(id)) throw new Error("bad id");
  return `/s/${id}#${fragmentToken(fragment)}`;
}

export function parseSnippetPath(pathname: string): string | null {
  const match = /^\/s\/([A-Za-z0-9_-]{22})$/.exec(pathname);
  const id = match?.[1];
  if (!id || !isValidId(id)) return null;
  return id;
}

export function parseFragment(hash: string): Uint8Array | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith("k=")) return null;
  const token = raw.slice(2);
  if (token.length === 0 || token.includes("=") || token.includes("&")) return null;
  return base64UrlToBytes(token, FRAGMENT_BYTES);
}
