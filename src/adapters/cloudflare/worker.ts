import { createApp, type HashRuntime } from "../../core/app.js";
import { sanitizeIp } from "../../core/rate-key.js";
import { parseEnvironment } from "../../shared/protocol.js";
import { RateLimiter } from "./rate-limiter.js";
import { SnippetObject } from "./snippet-object.js";

export { RateLimiter, SnippetObject };

function runtimeFor(env: Env): HashRuntime {
  return {
    environment: parseEnvironment(env.ENVIRONMENT),
    pepper: env.RATE_LIMIT_PEPPER ?? "",
    store: {
      create: (record) => env.SNIPPETS.getByName(record.id).create(record),
      open: (id, now) => env.SNIPPETS.getByName(id).open(now),
    },
    rateLimit: {
      consume: (bucket, limit, windowMs, now) => env.RATE_LIMITER.getByName(bucket).consume(limit, windowMs, now),
    },
    clientAddress: (request) => sanitizeIp(request.headers.get("cf-connecting-ip")),
    serve: (request) => serveAsset(env, request),
  };
}

async function serveAsset(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname.startsWith("/s/")) {
    const index = new URL("/index.html", url.origin);
    return env.ASSETS.fetch(new Request(index, { method: "GET" }));
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env): Promise<Response> {
    return createApp(runtimeFor(env)).fetch(request);
  },
} satisfies ExportedHandler<Env>;
