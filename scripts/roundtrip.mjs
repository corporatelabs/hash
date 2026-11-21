import esbuild from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const base = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const dir = mkdtempSync(path.join(tmpdir(), "hash-roundtrip-"));
const outfile = path.join(dir, "roundtrip.mjs");

await esbuild.build({
  stdin: {
    sourcefile: "roundtrip.ts",
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `
      import { seal, openSecret } from "./src/shared/crypto.ts";
      import { KDF_V1 } from "./src/shared/protocol.ts";
      import { bytesToBase64Url, randomBytes, base64ToBytes } from "./src/shared/bytes.ts";
      import { isValidId } from "./src/shared/link.ts";

      const base = ${JSON.stringify(base)};
      const password = "roundtrip-password-not-a-secret";
      const plaintext = "sealed by the round-trip";
      let id = bytesToBase64Url(randomBytes(16));
      if (!isValidId(id)) throw new Error("bad id");
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const sealed = await seal({ plaintext, password, id, expiresAt, burnAfterRead: false });
      const created = await fetch(base + "/api/snippets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: sealed.id,
          ciphertext: Buffer.from(sealed.ciphertext).toString("base64"),
          nonce: Buffer.from(sealed.nonce).toString("base64"),
          salt: Buffer.from(sealed.salt).toString("base64"),
          expiresAt,
          burnAfterRead: false,
          kdf: KDF_V1,
        }),
      });
      if (created.status !== 201) {
        throw new Error("create " + created.status + " " + await created.text());
      }
      const opened = await fetch(base + "/api/snippets/" + sealed.id + "/open", { method: "POST" });
      if (opened.status !== 200) {
        throw new Error("open " + opened.status + " " + await opened.text());
      }
      const body = await opened.json();
      const salt = base64ToBytes(body.salt);
      const nonce = base64ToBytes(body.nonce);
      const ciphertext = base64ToBytes(body.ciphertext);
      if (!salt || !nonce || !ciphertext) throw new Error("bad envelope");
      const plain = await openSecret({
        password,
        fragment: sealed.fragment,
        id: sealed.id,
        salt,
        nonce,
        ciphertext,
        expiresAt: body.expiresAt,
        burnAfterRead: false,
        kdf: KDF_V1,
      });
      if (plain !== plaintext) throw new Error("plaintext mismatch");
      const page = await fetch(base + "/s/" + sealed.id);
      if (page.status !== 200 || !(await page.text()).includes("hash")) {
        throw new Error("open page " + page.status);
      }
      console.log(JSON.stringify({ ok: true, base, id: sealed.id }));
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
});

await import(pathToFileURL(outfile).href);
