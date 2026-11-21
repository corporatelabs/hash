const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

export function applySecurityHeaders(headers: Headers, request: Request, kind: "api" | "document" | "asset"): void {
  const https = new URL(request.url).protocol === "https:";
  headers.set("Content-Security-Policy", https ? `${CSP}; upgrade-insecure-requests` : CSP);
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (https) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Cache-Control", "no-store");
  if (kind === "api") {
    headers.set("Pragma", "no-cache");
    headers.set("CDN-Cache-Control", "no-store");
    headers.set("Surrogate-Control", "no-store");
  }
}

export function headerKind(pathname: string): "api" | "document" | "asset" {
  if (pathname.startsWith("/api/") || pathname === "/healthz" || pathname === "/health") return "api";
  if (pathname === "/" || pathname.startsWith("/s/") || pathname.endsWith(".html")) return "document";
  return "asset";
}
