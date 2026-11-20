import { SqliteBackend } from "../../storage/sqlite.js";
import { RedisBackend } from "../../storage/redis.js";
import { createFileServer } from "./static.js";
import { startHttpServer } from "./server.js";
import { parseEnvironment, type HashEnvironment } from "../../shared/protocol.js";
import type { RateLimitStore, SnippetStore } from "../../core/store.js";

interface Settings {
  host: string;
  port: number;
  environment: HashEnvironment;
  pepper: string;
  storage: "sqlite" | "redis";
  databasePath: string;
  redisUrl: string;
  trustProxy: boolean;
  staticRoot: string;
}

function readSettings(env: NodeJS.ProcessEnv): Settings {
  const environment = parseEnvironment(env.ENVIRONMENT);
  const pepper = env.RATE_LIMIT_PEPPER ?? "";
  if (pepper.length < 16) throw new Error("RATE_LIMIT_PEPPER must be at least 16 characters");
  const storage = env.STORAGE ?? "sqlite";
  if (storage !== "sqlite" && storage !== "redis") throw new Error("STORAGE must be sqlite or redis");
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer from 0 to 65535");
  return {
    host: env.HOST ?? "0.0.0.0",
    port,
    environment,
    pepper,
    storage,
    databasePath: env.DATABASE_PATH ?? "./data/hash.sqlite",
    redisUrl: env.REDIS_URL ?? "",
    trustProxy: env.TRUST_PROXY === "true",
    staticRoot: env.STATIC_ROOT ?? "./dist/client",
  };
}

async function openStores(settings: Settings): Promise<{
  snippets: SnippetStore;
  rateLimit: RateLimitStore;
  sweep: (now: number) => Promise<void> | void;
  close: () => Promise<void> | void;
}> {
  if (settings.storage === "redis") {
    if (!settings.redisUrl) throw new Error("REDIS_URL is required when STORAGE=redis");
    const redis = await RedisBackend.connect(settings.redisUrl);
    return { snippets: redis.snippets, rateLimit: redis.rateLimit, sweep: (now) => redis.sweep(now), close: () => redis.close() };
  }
  const sqlite = SqliteBackend.open(settings.databasePath);
  return { snippets: sqlite.snippets, rateLimit: sqlite.rateLimit, sweep: (now) => sqlite.sweep(now), close: () => sqlite.close() };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const settings = readSettings(env);
  const stores = await openStores(settings);
  const server = await startHttpServer({
    host: settings.host,
    port: settings.port,
    runtime: {
      environment: settings.environment,
      pepper: settings.pepper,
      store: stores.snippets,
      rateLimit: stores.rateLimit,
      trustProxy: settings.trustProxy,
      serve: createFileServer(settings.staticRoot),
    },
  });
  const timer = setInterval(() => {
    Promise.resolve(stores.sweep(Date.now())).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : "Error";
      console.log(JSON.stringify({ event: "sweep.failed", name }));
    });
  }, 60_000);
  timer.unref();
  console.log(JSON.stringify({ event: "listen", port: server.port, storage: settings.storage, environment: settings.environment }));

  const shutdown = async () => {
    clearInterval(timer);
    await server.close();
    await stores.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.js") || entry.endsWith("main.ts")) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "startup failed";
    console.error(JSON.stringify({ event: "startup.failed", message }));
    process.exit(1);
  });
}
