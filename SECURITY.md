# Security policy

hash stores ciphertext. A vulnerability that lets the server, a log, or a third party see plaintext, passwords, or the URL fragment is in scope even when the cryptography itself is unchanged.

## Reporting

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/corporatelabs/hash/security/advisories/new) for this repository.

Do not open a public issue, and do not include a live secret, a password, or the part of a link after `#`.

We aim to acknowledge a report within three business days. There is no bug bounty.

## Supported versions

| Version | Status |
| --- | --- |
| 1.0.x on `main` | Supported |

## Deployment expectations

Self-hosted production must set `RATE_LIMIT_PEPPER` to a unique value of at least 16 characters. The development placeholder is refused in production. A production Worker, if you run one, sets the same secret with `wrangler secret put` and must not put it in `wrangler.jsonc` vars.
