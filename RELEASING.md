# Releasing hash

Nothing in this repository publishes an image until the `PUBLISH_ENABLED` variable is `true`. The repository is public. Do not deploy the Worker from the optional section below unless you mean to.

The hosted app is <https://hash.corporatelabs.ai>. Images, when published, are `ghcr.io/corporatelabs/hash`.

## Self-hosted production

The container is the deployment. Set `ENVIRONMENT=production` and a unique `RATE_LIMIT_PEPPER` of at least 16 characters. The development placeholder `development-only-pepper` is for `npm run dev:node` and `docker compose` on a laptop. The process refuses to start in production with that value or with a pepper shorter than 16 characters. SQLite is the default (`DATABASE_PATH=/data/hash.sqlite`). Redis is `STORAGE=redis` and `REDIS_URL`. Set `TRUST_PROXY=true` only behind a proxy that replaces `X-Forwarded-For`.

```bash
docker run -d --name hash -p 8080:8080 \
  -e ENVIRONMENT=production \
  -e RATE_LIMIT_PEPPER="$(openssl rand -base64 32)" \
  -v hash-data:/data \
  ghcr.io/corporatelabs/hash:latest
```

Pin a version (`ghcr.io/corporatelabs/hash:1.0.0`) once that tag exists. `latest` moves on each non-prerelease release.

Verify the signature:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/corporatelabs/hash/\.github/workflows/publish\.yml@refs/tags/v.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/corporatelabs/hash:latest
```

`docker compose up --build` builds this tree. It does not pull GHCR.

## Container publish

GHCR is the registry. Docker Hub is optional and is skipped when its secrets are unset. That skip does not fail the job and does not block GHCR.

| Name | Kind | Required | Value |
| --- | --- | --- | --- |
| `PUBLISH_ENABLED` | repository **variable** | yes, to publish | `true` |
| `DOCKERHUB_USERNAME` | repository **secret** | no | Docker Hub user, only if you also want `docker.io/corporatelabs/hash` |
| `DOCKERHUB_TOKEN` | repository **secret** | no | Docker Hub token. Both Hub secrets must be set, or Hub is skipped. |

Repository settings, under Settings → Actions → General → Workflow permissions:

- **Read and write permissions.** The default read-only token cannot create a release or push a package even when a workflow asks for more.
- **Allow GitHub Actions to create and approve pull requests.** release-please opens the release pull request with `GITHUB_TOKEN`. `pull-requests: write` in the workflow is not enough without this checkbox.

No GHCR secret. The publish job logs in with `GITHUB_TOKEN` and requests `packages: write`. Cosign is keyless and uses `id-token: write`, which the workflow already requests. Signatures go to the public Rekor log. That log stores the digest, not the source. The job also writes an SPDX SBOM, a SLSA provenance attestation, and an SBOM attestation on the GHCR image. Images are `linux/amd64` and `linux/arm64`.

After the first push, open the package at <https://github.com/corporatelabs/hash/pkgs/container/hash> and set its visibility to public if you want anonymous `docker pull`. A new GHCR package is private until you change that. This is the package, not the repository.

What a merge does, and what it does not do:

- Merging a pull request does not push an image while `PUBLISH_ENABLED` is unset. Both release-please and publish skip.
- Setting the variable does not run a workflow by itself.
- `.release-please-manifest.json` already records `1.0.0`. release-please treats that version as released. It does not open a `v1.0.0` release for the current tree. The next `feat` commit becomes `1.1.0`. The next `fix` becomes `1.0.1`. `docs` and `ci` commits do not open a release.
- The next push to `main` after the variable is `true`, or a manual run of Release Please, opens a release pull request when there is a releasable commit. Merging that pull request creates the tag and the GitHub Release. The Publish images workflow then runs, because it listens for a published release, and pushes `ghcr.io/corporatelabs/hash:<version>`, `:<major>.<minor>`, and `:latest`.
- To publish the current `main` as `1.0.0` without waiting for a later feature: after `PUBLISH_ENABLED` is `true`, publish the GitHub Release `v1.0.0` on `main` yourself. That is the event that pushes the image. To have release-please open the `1.0.0` pull request instead, set the manifest to `0.0.0` before that run.
- A manual run of Publish images on `main` pushes `:latest` only. Version tags come from a release tag such as `v1.0.0`.

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

## Now that the repository is public

- OpenSSF Scorecard runs on every push to `main`, weekly, and on a manual run. It publishes the result that the README badge reads. The badge stays empty until that job succeeds once.
- CodeQL runs on this public repository. It no longer takes the private-repository skip.
- Dependency review scans only after Dependency graph is on: Settings → Code security and analysis → Dependency graph. Until then the workflow says so and does not fail the pull request. A real finding still fails the check once the graph is on.
- TODO: OpenSSF Best Practices. Enroll the project at <https://www.bestpractices.dev/>. After you have a project id, add the badge to the README. Do not link a placeholder.
