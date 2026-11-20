# hash-wasm 4.13.0

Argon2id has no WebCrypto operation. This directory is the exact `dist/index.esm.js` from the npm tarball `hash-wasm@4.13.0`, published by Dani Biró (MIT). The client and the tests import this file. Nothing is loaded from a CDN.

| Field | Value |
| --- | --- |
| Package | hash-wasm |
| Version | 4.13.0 |
| Registry tarball | https://registry.npmjs.org/hash-wasm/-/hash-wasm-4.13.0.tgz |
| Tarball integrity | `sha512-GrWl7wsV46fKIXQZB5ebskLZLAmKL6d9RS0fspCxDeQyjoNu1AfTJTMLPOJyfzaQm0ldFiwFN21/w+sE/kgEFQ==` |
| Vendored file | `index.esm.js` |
| Vendored sha256 | `f3e4fde16c83c8e70ca77f208ebb0885c6658ce2574f51eae3a49e93d3c3ffd8` |

## Reproduce

```bash
npm pack hash-wasm@4.13.0 --pack-destination /tmp
tar -xOf /tmp/hash-wasm-4.13.0.tgz package/dist/index.esm.js | sha256sum
```

The digest must equal the sha256 above. `scripts/verify-vendor.mjs` checks the vendored file on every test run.

The Argon2 WebAssembly inside the file is hash-wasm's build of the Password Hashing Competition reference implementation. We do not rebuild that wasm here. Rebuilding it would be a different binary and could change the envelope, which would break snippets already stored at hash.corporatelabs.ai.
