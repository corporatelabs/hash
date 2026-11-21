import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createApp, type HashRuntime } from "../../core/app.js";
import { nodeClientAddress } from "./ip.js";

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  const body = await readBody(req);
  return new Request(url, { method, headers, body });
}

async function writeResponse(req: IncomingMessage, res: ServerResponse, response: Response): Promise<void> {
  const headers = Object.fromEntries(response.headers.entries());
  const bytes = new Uint8Array(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  if (req.method === "HEAD") res.end();
  else res.end(bytes);
}

export async function startHttpServer(options: {
  runtime: Omit<HashRuntime, "clientAddress"> & { trustProxy: boolean };
  host: string;
  port: number;
}): Promise<RunningServer> {
  const app = createApp({
    environment: options.runtime.environment,
    pepper: options.runtime.pepper,
    store: options.runtime.store,
    rateLimit: options.runtime.rateLimit,
    serve: options.runtime.serve,
    clientAddress: (request) => nodeClientAddress(request, remotes.get(request) ?? null, options.runtime.trustProxy),
  });
  const remotes = new WeakMap<Request, string | null>();

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = await toRequest(req);
        remotes.set(request, req.socket.remoteAddress ?? null);
        const response = await app.fetch(request);
        await writeResponse(req, res, response);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "internal" }));
        } else {
          res.end();
        }
      }
    })();
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(options.port, options.host, () => {
      const address = server.address();
      resolve(address && typeof address === "object" ? address.port : options.port);
    });
  });

  return { port, close: () => closeServer(server) };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
