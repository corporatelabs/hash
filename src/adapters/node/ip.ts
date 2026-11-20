import { sanitizeIp } from "../../core/rate-key.js";

/**
 * Socket address wins unless TRUST_PROXY is enabled. Only enable that behind
 * a proxy that overwrites X-Forwarded-For. A client who can reach the process
 * directly must not be able to pick their rate-limit bucket.
 */
export function nodeClientAddress(request: Request, remoteAddress: string | null, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0] ?? null;
    const parsed = sanitizeIp(first);
    if (parsed) return parsed;
  }
  return sanitizeIp(remoteAddress) ?? sanitizeIp(request.headers.get("cf-connecting-ip"));
}
