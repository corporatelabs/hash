# Releasing hash

Nothing in this repository publishes itself. Image pushes, cosign signing, SBOM attestation, SLSA provenance, and release-please are skipped until the gates below are set. Leave them unset until you mean to publish. Do not change the repository from private to public as part of a normal deploy.

The hosted app is <https://hash.corporatelabs.ai>.

## Self-hosted production

The container is the deployment. Set `ENVIRONMENT=production` and a unique `RATE_LIMIT_PEPPER` of at least 16 characters. The development placeholder `development-only-pepper` is for `npm run dev:node` and `docker compose` on a laptop. The process refuses to start in production with that value or with a pepper shorter than 16 characters. SQLite is the default (`DATABASE_PATH=/data/hash.sqlite`). Redis is `STORAGE=redis` and `REDIS_URL`. Set `TRUST_PROXY=true` only behind a proxy that replaces `X-Forwarded-For`.

```bash
docker run -d --name hash -p 8080:8080 \
  -e ENVIRONMENT=production \
  -e RATE_LIMIT_PEPPER="$(openssl rand -base64 32)" \
  -v hash-data:/data \
  hash
```

## Container publish

All of these stay unset until you want images on GHCR and Docker Hub.

| Name | Kind | Value |
| --- | --- | --- |
| `PUBLISH_ENABLED` | repository **variable** | `true` |
| `DOCKERHUB_USERNAME` | repository **secret** | Docker Hub user that can push `corporatelabs/hash` |
| `DOCKERHUB_TOKEN` | repository **secret** | Docker Hub access token |

Also:

- Create the Docker Hub repository `corporatelabs/hash` (or let the first push create it, if the account may do that).
- `GITHUB_TOKEN` is provided by Actions. It can push to `ghcr.io/corporatelabs/hash`. No extra GHCR secret.
- Cosign is keyless. It needs `id-token: write`, which the publish workflow already requests. Signatures are recorded in the public Rekor log. That log stores the digest, not the source.
- The first publish should be a GitHub Release whose tag looks like `v1.0.0`, or a manual run of the Publish images workflow after `PUBLISH_ENABLED` is true. release-please only opens release PRs once that variable is `true`. `.release-please-manifest.json` already records `1.0.0`, so the next conventional commit after that becomes `1.0.1` or `1.1.0`. To have release-please open the `1.0.0` release itself, set the manifest to `0.0.0` before enabling it.
- Multi-arch images are `linux/amd64` and `linux/arm64`. The workflow attaches an SPDX SBOM, signs both registries with cosign, and writes SLSA build provenance plus an SBOM attestation.

If `PUBLISH_ENABLED` is anything other than `true`, the release-please and publish jobs do not run. If it is `true` but either Docker Hub secret is empty, publish exits before pushing anywhere, including GHCR.

## Optional: Worker (Cloudflare)

Bindings, class names, and the `v1` migration are already in `wrangler.jsonc`. Do not rename `SNIPPETS`, `RATE_LIMITER`, `SnippetObject`, `RateLimiter`, or migration tag `v1`.

1. `npm ci`
2. `npx wrangler login` on the account that owns the zone.
3. Set the rate-limit pepper if this deploy does not already have one. Production refuses a missing pepper and refuses the development placeholder. Do not add `RATE_LIMIT_PEPPER` under `vars` in `wrangler.jsonc`. A deploy would overwrite the secret.

   ```bash
   openssl rand -base64 32 | npx wrangler secret put RATE_LIMIT_PEPPER
   ```

   `wrangler secret put` publishes a Worker version. Local development uses `.dev.vars` (see `.dev.vars.example`), which is not uploaded.

4. Uncomment `routes` in `wrangler.jsonc` so the custom domain attaches. Cloudflare creates the DNS record for a custom domain on a zone you already host. Do not buy or delegate a new domain from this repo.

   ```jsonc
   "routes": [
     { "pattern": "hash.corporatelabs.ai", "custom_domain": true }
   ]
   ```

5. Deploy:

   ```bash
   npm run build:client
   npx wrangler deploy
   ```

## What only works once the repository is public

- OpenSSF Scorecard (the workflow runs only when visibility is public). The badge in the README will not render usefully before that.
- The OpenSSF Best Practices badge is a placeholder. After the repo is public, enroll at <https://www.bestpractices.dev/> and replace `PLACEHOLDER` in the README with the project id.
- CodeQL and dependency review are in the workflows, and on this private repository they skip with a note. They run when the repository is public. On a private repository they need GitHub Advanced Security before they can scan.
- GHCR packages for a private repository are private. Change the package to public only if you want anonymous pulls, after you are ready for the repo itself to be public.
