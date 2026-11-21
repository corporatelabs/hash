# Dependencies

Runtime dependencies are the `dependencies` field in `package.json`. That list is empty. `scripts/check-runtime-deps.mjs` fails CI if it grows without an entry in `runtime-deps.json` and a reason in this file.

Before this change the runtime list was five packages: `hono`, `@hono/node-server`, `better-sqlite3`, `ioredis`, and `hash-wasm`.

| Surface | Now |
| --- | --- |
| Client | Vendored hash-wasm for Argon2id. Everything else is WebCrypto, `fetch`, URL, TextEncoder, and DOM. No framework. |
| Worker | WebCrypto, `fetch`, Durable Objects. No npm runtime package. |
| Node, SQLite | `node:http`, `node:sqlite`, `node:fs`, `node:crypto`. |
| Node, Redis | The same, plus `src/storage/redis-client.ts`, a small RESP client on `node:net`. It is imported only when `STORAGE=redis`. |

## Why hash-wasm remains

WebCrypto has no Argon2id. The envelope already shipped at https://hash.corporatelabs.ai was produced by hash-wasm 4.13.0, so a different implementation would not open those snippets. The file `vendor/hash-wasm/index.esm.js` is that published build, checked by sha256 in `vendor/hash-wasm/PROVENANCE.md`. It is bundled into the client. It is not loaded from a CDN. Its license is MIT, in `vendor/hash-wasm/LICENSE`.

## Dev-only packages

`wrangler`, Vitest, TypeScript, ESLint, esbuild, and the font packages are `devDependencies`. `npm prune --omit=dev` removes those packages from the image. IBM Plex Sans and IBM Plex Mono (Copyright 2017–2019 IBM Corp.) are SIL Open Font License 1.1. The client build copies the latin woff2 subsets, plus each package's OFL text, from `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` into `dist/client/fonts`, and that directory is what the image serves. Nothing is loaded from a CDN. These packages are not runtime npm dependencies.

`npm ci --ignore-scripts` is what CI and the image build run. Nothing in the runtime path needs a package install script.
