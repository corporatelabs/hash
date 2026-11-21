import { connect, type Socket } from "node:net";

type Reply = string | number | null | Reply[];

interface Parsed {
  value: Reply;
  rest: Buffer;
  error?: Error;
}

function encode(args: string[]): Buffer {
  const chunks: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const data = Buffer.from(arg);
    chunks.push(Buffer.from(`$${data.length}\r\n`), data, Buffer.from("\r\n"));
  }
  return Buffer.concat(chunks);
}

function parse(buf: Buffer): Parsed | null {
  if (buf.length === 0) return null;
  const newline = buf.indexOf("\r\n");
  if (newline < 0) return null;
  const prefix = String.fromCharCode(buf[0] ?? 0);
  const head = buf.subarray(1, newline).toString("utf8");
  const rest = buf.subarray(newline + 2);
  if (prefix === "+") return { value: head, rest };
  if (prefix === "-") return { value: null, rest, error: new Error(head) };
  if (prefix === ":") return { value: Number(head), rest };
  if (prefix === "$") {
    const length = Number(head);
    if (length < 0) return { value: null, rest };
    if (rest.length < length + 2) return null;
    return { value: rest.subarray(0, length).toString("utf8"), rest: rest.subarray(length + 2) };
  }
  if (prefix === "*") {
    const count = Number(head);
    if (count < 0) return { value: null, rest };
    const items: Reply[] = [];
    let cursor = rest;
    for (let i = 0; i < count; i += 1) {
      const item = parse(cursor);
      if (!item) return null;
      if (item.error) return { value: null, rest: item.rest, error: item.error };
      items.push(item.value);
      cursor = item.rest;
    }
    return { value: items, rest: cursor };
  }
  return { value: null, rest: Buffer.alloc(0), error: new Error("bad redis reply") };
}

/** Small RESP client for the commands hash uses. No connection pool and no Lua of our own beyond EVAL. */
export class MiniRedis {
  private socket: Socket | null = null;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private readonly queue: Array<{ resolve: (value: Reply) => void; reject: (error: Error) => void }> = [];

  static connect(url: string, timeoutMs = 2_000): Promise<MiniRedis> {
    const parsed = new URL(url);
    const client = new MiniRedis();
    const port = parsed.port ? Number(parsed.port) : 6379;
    return new Promise((resolve, reject) => {
      const socket = connect({ host: parsed.hostname, port });
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.setTimeout(timeoutMs);
      socket.once("timeout", () => fail(Object.assign(new Error("redis timeout"), { code: "ETIMEDOUT" })));
      socket.once("error", fail);
      socket.once("connect", () => {
        socket.setTimeout(0);
        socket.removeListener("error", fail);
        client.attach(socket);
        void (async () => {
          try {
            if (parsed.password) await client.command("AUTH", decodeURIComponent(parsed.password));
            resolve(client);
          } catch (error) {
            socket.destroy();
            reject(error instanceof Error ? error : new Error("redis auth"));
          }
        })();
      });
    });
  }

  private attach(socket: Socket): void {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.pending = Buffer.concat([this.pending, chunk]);
      this.drain();
    });
    socket.on("error", (error) => this.failAll(error));
    socket.on("close", () => this.failAll(Object.assign(new Error("redis closed"), { code: "NR_CLOSED" })));
  }

  private failAll(error: Error): void {
    const waiting = this.queue.splice(0);
    for (const waiter of waiting) waiter.reject(error);
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const parsed = parse(this.pending);
      if (!parsed) return;
      this.pending = parsed.rest;
      const waiter = this.queue.shift();
      if (!waiter) return;
      if (parsed.error) waiter.reject(parsed.error);
      else waiter.resolve(parsed.value);
    }
  }

  command(...args: string[]): Promise<Reply> {
    const socket = this.socket;
    if (!socket) return Promise.reject(Object.assign(new Error("redis closed"), { code: "NR_CLOSED" }));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      socket.write(encode(args));
    });
  }

  async ping(): Promise<string> {
    const reply = await this.command("PING");
    return typeof reply === "string" ? reply : "";
  }

  async get(key: string): Promise<string | null> {
    const reply = await this.command("GET", key);
    return typeof reply === "string" ? reply : null;
  }

  eval(script: string, numKeys: number, ...args: string[]): Promise<Reply> {
    return this.command("EVAL", script, String(numKeys), ...args);
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const reply = await this.command("ZRANGEBYSCORE", key, String(min), String(max));
    if (!Array.isArray(reply)) return [];
    return reply.filter((item): item is string => typeof item === "string");
  }

  async quit(): Promise<void> {
    try {
      await this.command("QUIT");
    } catch {
      // The server often closes before the reply is read.
    }
    this.socket?.end();
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}
