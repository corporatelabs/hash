# Changelog

## [1.0.1](https://github.com/corporatelabs/hash/compare/hash-v1.0.0...hash-v1.0.1) (2026-11-21)


### Bug Fixes

* keep the release publish job on contents read ([#14](https://github.com/corporatelabs/hash/issues/14)) ([66c612f](https://github.com/corporatelabs/hash/commit/66c612f50582edbb5fa9558ec250d998875083fb))

## [1.0.0] - 2026-11-20

### Added

- Browser encryption with Argon2id, HKDF, and AES-256-GCM. The URL fragment is a 256-bit secret and is not sent to the server.
- One HTTP API. The container (SQLite, optional Redis) is the way to run it. A Cloudflare Worker with Durable Objects is optional.
- One-time burn and expiry, with atomic delete on SQLite, Redis, and Durable Objects.
- Tests, a pinned crypto vector, and a container image that refuses to boot in production without a real rate-limit pepper.

This version is the source of truth. Container tags and GitHub Releases are cut only after publishing is enabled. See [RELEASING.md](RELEASING.md).
