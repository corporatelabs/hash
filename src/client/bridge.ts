import { bytesToBase64Url } from "../shared/bytes.js";
import { randomBytes } from "../shared/bytes.js";
import { ID_BYTES, type KdfParams } from "../shared/protocol.js";

export interface SealResult {
  fragment: string;
  id: string;
  ciphertext: string;
  nonce: string;
  salt: string;
  expiresAt: number;
  burnAfterRead: boolean;
  kdf: KdfParams;
}

interface Ok {
  id: number;
  ok: true;
  result: SealResult | { plaintext: string };
}

interface Fail {
  id: number;
  ok: false;
  error: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: Ok["result"]) => void; reject: (error: Error) => void }>();

function cryptoWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/crypto-worker.js", { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<Ok | Fail>) => {
    const data = event.data;
    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new Error(data.error));
  });
  worker.addEventListener("error", () => {
    for (const waiter of pending.values()) waiter.reject(new Error("worker"));
    pending.clear();
    worker = null;
  });
  return worker;
}

function call(message: Record<string, unknown>, timeoutMs: number): Promise<Ok["result"]> {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    cryptoWorker().postMessage({ ...message, id });
  });
}

export function newSnippetId(): string {
  return bytesToBase64Url(randomBytes(ID_BYTES));
}

export async function sealInBrowser(input: {
  plaintext: string;
  password: string;
  id: string;
  expiresAt: number;
  burnAfterRead: boolean;
}): Promise<SealResult> {
  const result = await call({ op: "seal", snippetId: input.id, ...input }, 60_000);
  if (!("ciphertext" in result)) throw new Error("invalid");
  return result;
}

export async function openInBrowser(input: {
  password: string;
  fragment: string;
  envelope: {
    id: string;
    ciphertext: string;
    nonce: string;
    salt: string;
    expiresAt: number;
    burnAfterRead: boolean;
    kdf: KdfParams;
  };
}): Promise<string> {
  const result = await call({ op: "open", ...input }, 60_000);
  if (!("plaintext" in result)) throw new Error("invalid");
  return result.plaintext;
}
