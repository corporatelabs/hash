import { bytesToBase64Url, utf8 } from "../shared/bytes.js";
import { DEV_PEPPER, type HashEnvironment, type RateAction } from "../shared/protocol.js";

export function sanitizeIp(value: string | null): string | null {
  if (!value) return null;
  const ip = value.trim();
  if (ip.length === 0 || ip.length > 128) return null;
  if (/[\r\n\0\s]/.test(ip)) return null;
  return ip;
}

export function pepperProblem(environment: HashEnvironment, pepper: string): "short_pepper" | "dev_pepper" | null {
  if (pepper.length < 16) return "short_pepper";
  if (environment === "production" && pepper === DEV_PEPPER) return "dev_pepper";
  return null;
}

export async function rateBucket(pepper: string, ip: string, action: RateAction): Promise<string> {
  const encoded = utf8(`hash-v1\0${pepper}\0${action}\0${ip}`);
  const input = new Uint8Array(encoded.byteLength);
  input.set(encoded);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return `${action}:${bytesToBase64Url(new Uint8Array(digest))}`;
}
