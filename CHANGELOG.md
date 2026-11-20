# Changelog

## [1.0.0] - 2026-11-20

### Added

- Browser encryption with Argon2id, HKDF, and AES-256-GCM. The URL fragment is a 256-bit secret and is not sent to the server.
- A Hono API served by a Cloudflare Worker (Durable Objects) and by a Node container (SQLite or Redis).
- One-time burn and expiry, with atomic delete on SQLite, Redis, and Durable Objects.
- Tests, a pinned crypto vector, and a container image that refuses to boot in production without a real rate-limit pepper.

This version is the source of truth. Container tags and GitHub Releases are cut only after publishing is enabled. See [RELEASING.md](RELEASING.md).
