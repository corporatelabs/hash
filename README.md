# hash

Share a secret by a short link. The browser encrypts it. The server stores ciphertext only.

Hosted target: [https://hash.corporatelabs.ai](https://hash.corporatelabs.ai). Nothing in this repo is deployed for you, and the custom domain route ships commented out.

## Deploy the Worker

From this branch, with Wrangler logged into the Cloudflare account that owns the zone:

```bash
npm ci
npx wrangler login
```

In `wrangler.jsonc`, uncomment the `routes` block:

```jsonc
"routes": [
  { "pattern": "hash.corporatelabs.ai", "custom_domain": true }
]
```

Then build and deploy. `wrangler deploy` runs the client build itself.

```bash
npm run build:client
npx wrangler deploy
```

Optional, and worth doing before the site is public: replace the placeholder rate-limit pepper. This creates a new Worker version.

```bash
openssl rand -base64 32 | npx wrangler secret put RATE_LIMIT_PEPPER
```

There is no account id in the config. Durable Object classes are `SnippetObject` and `RateLimiter` (SQLite-backed, migration `v1`).

Local check, without deploying:

```bash
npm run dev
# other shell
BASE_URL=http://127.0.0.1:8787 node scripts/roundtrip.mjs
```

`npm run dev` sets `ENVIRONMENT=development` so local requests without `CF-Connecting-IP` still rate-limit.

## Self-host

```bash
docker build -t hash .
docker run --rm -p 8080:8080 \
  -e ENVIRONMENT=development \
  -e RATE_LIMIT_PEPPER=development-only-pepper \
  -v hash-data:/data \
  hash
```

Production containers should set `ENVIRONMENT=production` and a unique `RATE_LIMIT_PEPPER` of at least 16 characters. SQLite is the default (`DATABASE_PATH=/data/hash.sqlite`). Redis: `STORAGE=redis` and `REDIS_URL`.

```bash
docker compose up --build
STORAGE=redis docker compose --profile redis up --build
```

## Develop

```bash
npm ci
npm test
npm run dev:node
```

Node 22. Client crypto is Argon2id (64 MiB, t=3, p=1) then HKDF-SHA-256, then AES-256-GCM. The URL fragment (`#k=`) is a 256-bit secret and is never sent to the server. There is no password recovery.

## License

MIT. See [LICENSE](LICENSE).
