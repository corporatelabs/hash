import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttpServer } from "../../src/adapters/node/server.js";
import { SqliteBackend } from "../../src/storage/sqlite.js";
import { createFileServer } from "../../src/adapters/node/static.js";
import { DecryptError, openSecret, seal } from "../../src/shared/crypto.js";
import { bytesToBase64Url, base64ToBytes, randomBytes } from "../../src/shared/bytes.js";
import { ID_BYTES, KDF_V1 } from "../../src/shared/protocol.js";
import { isValidId, sharePath } from "../../src/shared/link.js";

let base = "";
let closeServer: (() => Promise<void>) | null = null;
let db: SqliteBackend | null = null;

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hash-e2e-"));
  db = SqliteBackend.open(path.join(dir, "hash.sqlite"));
  const running = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    runtime: {
      environment: "test",
      pepper: "development-only-pepper",
      store: db.snippets,
      rateLimit: db.rateLimit,
      trustProxy: false,
      serve: createFileServer(path.join(process.cwd(), "dist/client")),
    },
  });
  base = `http://127.0.0.1:${running.port}`;
  closeServer = () => running.close();
});

afterAll(async () => {
  await closeServer?.();
  db?.close();
});

async function createFromPlaintext(plaintext: string, password: string, burnAfterRead: boolean, expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000) {
  let id = bytesToBase64Url(randomBytes(ID_BYTES));
  while (!isValidId(id)) id = bytesToBase64Url(randomBytes(ID_BYTES));
  const sealed = await seal({ plaintext, password, id, expiresAt, burnAfterRead });
  const response = await fetch(`${base}/api/snippets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: sealed.id,
      ciphertext: Buffer.from(sealed.ciphertext).toString("base64"),
      nonce: Buffer.from(sealed.nonce).toString("base64"),
      salt: Buffer.from(sealed.salt).toString("base64"),
      expiresAt: sealed.expiresAt,
      burnAfterRead,
      kdf: KDF_V1,
    }),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const link = new URL(sharePath(sealed.id, sealed.fragment), base);
  expect(link.hash.startsWith("#k=")).toBe(true);
  expect(link.pathname).not.toContain(link.hash.slice(1));
  return { sealed, link };
}

async function openApi(id: string) {
  const response = await fetch(`${base}/api/snippets/${id}/open`, { method: "POST" });
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe("node create and open", () => {
  it("decrypts a secret, rejects the wrong password, burns once, and expires", async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");

    const happy = await createFromPlaintext("the launch code is north-seven", "hash-test-password-not-a-secret", false);
    const opened = await openApi(happy.sealed.id);
    expect(opened.response.status).toBe(200);
    const salt = base64ToBytes(String(opened.body.salt));
    const nonce = base64ToBytes(String(opened.body.nonce));
    const ciphertext = base64ToBytes(String(opened.body.ciphertext));
    if (!salt || !nonce || !ciphertext) throw new Error("envelope");
    const plain = await openSecret({
      password: "hash-test-password-not-a-secret",
      fragment: happy.sealed.fragment,
      id: happy.sealed.id,
      salt,
      nonce,
      ciphertext,
      expiresAt: Number(opened.body.expiresAt),
      burnAfterRead: false,
      kdf: KDF_V1,
    });
    expect(plain).toBe("the launch code is north-seven");
    await expect(
      openSecret({
        password: "wrong-password-here",
        fragment: happy.sealed.fragment,
        id: happy.sealed.id,
        salt,
        nonce,
        ciphertext,
        expiresAt: Number(opened.body.expiresAt),
        burnAfterRead: false,
        kdf: KDF_V1,
      }),
    ).rejects.toBeInstanceOf(DecryptError);
    const again = await openApi(happy.sealed.id);
    expect(again.response.status).toBe(200);

    const burned = await createFromPlaintext("burn me", "another-long-password-1", true);
    const first = await openApi(burned.sealed.id);
    expect(first.response.status).toBe(200);
    expect(first.body.burnAfterRead).toBe(true);
    const second = await openApi(burned.sealed.id);
    expect(second.response.status).toBe(410);
    expect(second.body).toEqual({ error: "gone", reason: "burned" });

    const expired = await createFromPlaintext("already gone", "another-long-password-2", false, Date.now() - 5_000);
    const gone = await openApi(expired.sealed.id);
    expect(gone.response.status).toBe(410);
    expect(gone.body).toEqual({ error: "gone", reason: "expired" });
  });
});
