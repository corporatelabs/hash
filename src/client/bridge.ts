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

interface Progress {
  id: number;
  progress: CryptoProgress;
}

export type CryptoProgress = "kdf" | "encrypt" | "decrypt";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  {
    resolve: (value: Ok["result"]) => void;
    reject: (error: Error) => void;
    onProgress?: (stage: CryptoProgress) => void;
  }
>();

function cryptoWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/crypto-worker.js", { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<Ok | Fail | Progress>) => {
    const data = event.data;
    const waiter = pending.get(data.id);
    if (!waiter) return;
    if ("progress" in data) {
      waiter.onProgress?.(data.progress);
      return;
    }
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

function call(
  message: Record<string, unknown>,
  timeoutMs: number,
  onProgress?: (stage: CryptoProgress) => void,
): Promise<Ok["result"]> {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout"));
    }, timeoutMs);
    const waiter: {
      resolve: (value: Ok["result"]) => void;
      reject: (error: Error) => void;
      onProgress?: (stage: CryptoProgress) => void;
    } = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    if (onProgress) waiter.onProgress = onProgress;
    pending.set(id, waiter);
    cryptoWorker().postMessage({ ...message, id });
  });
}

export function newSnippetId(): string {
  return bytesToBase64Url(randomBytes(ID_BYTES));
}

export async function sealInBrowser(
  input: {
    plaintext: string;
    password: string;
    id: string;
    expiresAt: number;
    burnAfterRead: boolean;
  },
  onProgress?: (stage: CryptoProgress) => void,
): Promise<SealResult> {
  const result = await call({ op: "seal", snippetId: input.id, ...input }, 60_000, onProgress);
  if (!("ciphertext" in result)) throw new Error("invalid");
  return result;
}

export async function openInBrowser(
  input: {
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
  },
  onProgress?: (stage: CryptoProgress) => void,
): Promise<string> {
  const result = await call({ op: "open", ...input }, 60_000, onProgress);
  if (!("plaintext" in result)) throw new Error("invalid");
  return result.plaintext;
}
