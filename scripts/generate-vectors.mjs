import esbuild from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(path.join(tmpdir(), "hash-vec-"));
const outfile = path.join(dir, "gen.mjs");
await esbuild.build({
  stdin: {
    contents: `
      import { seal } from "./src/shared/crypto.ts";
      import { bytesToHex, hexToBytes } from "./src/shared/bytes.ts";
      const salt = hexToBytes("000102030405060708090a0b0c0d0e0f");
      const nonce = hexToBytes("101112131415161718191a1b");
      const fragment = hexToBytes("202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f");
      const sealed = await seal({
        password: "hash-test-password-not-a-secret",
        plaintext: "the launch code is north-seven",
        id: "AAAAAAAAAAAAAAAAAAAAAA",
        expiresAt: 1760000000000,
        burnAfterRead: false,
        salt,
        nonce,
        fragment,
      });
      console.log(JSON.stringify({
        password: "hash-test-password-not-a-secret",
        plaintext: "the launch code is north-seven",
        id: "AAAAAAAAAAAAAAAAAAAAAA",
        expiresAt: 1760000000000,
        burnAfterRead: false,
        saltHex: bytesToHex(salt),
        nonceHex: bytesToHex(nonce),
        fragmentHex: bytesToHex(fragment),
        aesKeyHex: bytesToHex(sealed.aesKey),
        aadHex: bytesToHex(sealed.aad),
        ciphertextHex: bytesToHex(sealed.ciphertext),
      }, null, 2));
    `,
    resolveDir: process.cwd(),
    sourcefile: "gen.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
});

const child = await import(pathToFileURL(outfile).href);
void child;
writeFileSync(path.join(dir, "ran"), "1");
