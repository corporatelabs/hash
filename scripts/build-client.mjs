import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "client");
await rm(path.join(out, "fonts"), { recursive: true, force: true });
await mkdir(path.join(out, "fonts"), { recursive: true });
await mkdir(path.join(out, ".well-known"), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src/client/main.ts")],
  outfile: path.join(out, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  sourcemap: false,
});

await esbuild.build({
  entryPoints: [path.join(root, "src/client/crypto-worker.ts")],
  outfile: path.join(out, "crypto-worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  sourcemap: false,
});

await esbuild.build({
  entryPoints: [path.join(root, "src/client/styles.css")],
  outfile: path.join(out, "app.css"),
  bundle: true,
  minify: true,
  legalComments: "none",
  external: ["/fonts/*"],
});

const fonts = [
  ["node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", "fonts/plex-sans-400.woff2"],
  ["node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2", "fonts/plex-sans-500.woff2"],
  ["node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", "fonts/plex-sans-600.woff2"],
  ["node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", "fonts/plex-400.woff2"],
  ["node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2", "fonts/plex-500.woff2"],
];
const fontLicenses = [
  ["node_modules/@fontsource/ibm-plex-sans/LICENSE", "fonts/IBM-Plex-Sans-OFL.txt"],
  ["node_modules/@fontsource/ibm-plex-mono/LICENSE", "fonts/IBM-Plex-Mono-OFL.txt"],
];
for (const [from, to] of [...fonts, ...fontLicenses]) {
  await copyFile(path.join(root, from), path.join(out, to));
}
await copyFile(path.join(root, "src/client/favicon.svg"), path.join(out, "favicon.svg"));
await copyFile(path.join(root, "src/client/robots.txt"), path.join(out, "robots.txt"));
await copyFile(path.join(root, "src/client/well-known/security.txt"), path.join(out, ".well-known/security.txt"));

const js = await readFile(path.join(out, "app.js"));
const css = await readFile(path.join(out, "app.css"));
const worker = await readFile(path.join(out, "crypto-worker.js"));
const sri = (buf) => `sha384-${createHash("sha384").update(buf).digest("base64")}`;
const html = (await readFile(path.join(root, "src/client/index.html"), "utf8"))
  .replace("__CSS_SRI__", sri(css))
  .replace("__JS_SRI__", sri(js));
if (html.includes("__")) throw new Error("SRI placeholder left in index.html");
await writeFile(path.join(out, "index.html"), html);

const banned = [/googleapis/, /cdn\./, /unpkg/, /jsdelivr/, /cloudflareinsights/, /\beval\(/];
const bundle = `${js.toString("utf8")}\n${worker.toString("utf8")}`;
for (const pattern of banned) {
  if (pattern.test(bundle)) throw new Error(`client bundle failed supply check: ${pattern}`);
}

await writeFile(
  path.join(out, "integrity.json"),
  JSON.stringify({ appJs: sri(js), appCss: sri(css), cryptoWorker: sri(worker) }, null, 2),
);
