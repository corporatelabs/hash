import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createFileServer(root: string): (request: Request) => Promise<Response> {
  const rootResolved = path.resolve(root);
  return async (request) => {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname === "/" || pathname.startsWith("/s/")) pathname = "/index.html";
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (decoded.includes("\0")) return new Response("Not found", { status: 404 });
    const file = path.resolve(rootResolved, `.${decoded}`);
    const prefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;
    if (file !== rootResolved && !file.startsWith(prefix)) return new Response("Not found", { status: 404 });
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(file));
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const headers = {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "content-length": String(bytes.byteLength),
    };
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(bytes, { status: 200, headers });
  };
}
