import { serve, type ServerType } from "@hono/node-server";
import type { IncomingMessage } from "node:http";
import { createApp, type HashRuntime } from "../../core/app.js";
import { nodeClientAddress } from "./ip.js";

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

interface NodeBindings {
  incoming: IncomingMessage;
}

function isNodeBindings(value: unknown): value is NodeBindings {
  return typeof value === "object" && value !== null && "incoming" in value;
}

export async function startHttpServer(options: {
  runtime: Omit<HashRuntime, "clientAddress"> & { trustProxy: boolean };
  host: string;
  port: number;
}): Promise<RunningServer> {
  const remotes = new WeakMap<Request, string | null>();
  const app = createApp({
    environment: options.runtime.environment,
    pepper: options.runtime.pepper,
    store: options.runtime.store,
    rateLimit: options.runtime.rateLimit,
    serve: options.runtime.serve,
    clientAddress: (request) => nodeClientAddress(request, remotes.get(request) ?? null, options.runtime.trustProxy),
  });

  let server!: ServerType;
  const port = await new Promise<number>((resolve) => {
    server = serve(
      {
        fetch: (request, env) => {
          const remote = isNodeBindings(env) ? (env.incoming.socket.remoteAddress ?? null) : null;
          remotes.set(request, remote);
          return app.fetch(request);
        },
        hostname: options.host,
        port: options.port,
      },
      (info) => resolve(info.port),
    );
  });
  return {
    port,
    close: () => closeServer(server),
  };
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
