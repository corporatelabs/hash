# Contributing

hash is a zero-knowledge paste. Changes should keep the server from ever needing a password, a fragment, or plaintext.

## Setup

```bash
nvm use
cp .dev.vars.example .dev.vars
npm ci
npm test
npm run dev
```

Node 22, from `.nvmrc`. `npm run dev` loads `.dev.vars` and does not upload it. Do not put `RATE_LIMIT_PEPPER` in `wrangler.jsonc`.

Redis tests use `REDIS_URL` (default `redis://127.0.0.1:6379`). In CI, Redis is required. Locally they skip when Redis is down.

## What we expect in a change

- TypeScript, strict. No `any` on the Worker `Env`.
- Crypto stays in `src/shared/crypto.ts` and uses hash-wasm plus WebCrypto. Do not add a hand-rolled cipher, KDF, or MAC.
- The Worker must not import `better-sqlite3`, `ioredis`, or `hash-wasm`.
- Durable Object binding names (`SNIPPETS`, `RATE_LIMITER`), class names (`SnippetObject`, `RateLimiter`), and the `v1` migration tag stay stable. A new migration gets a new tag.
- Tests cover the behavior you changed. One-time reads need a concurrency test on every storage backend you touch.
- Do not commit secrets, `.dev.vars`, or production peppers.
- Do not deploy, publish an image, or change repository visibility from a pull request.

## Reviews

@orsahar is the code owner. See [SECURITY.md](SECURITY.md) for vulnerability reports and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how to treat people.
