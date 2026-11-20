import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".wrangler/**", "worker-configuration.d.ts", "coverage/**", "data/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["src/adapters/cloudflare/**/*.ts", "src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["better-sqlite3", "ioredis", "hash-wasm", "**/storage/**", "**/shared/crypto", "**/shared/crypto.js", "**/client/**"],
              message: "The API core and the Worker must not import storage engines, Node drivers, or the client crypto.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/cloudflare/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["better-sqlite3", "ioredis", "hash-wasm", "node:*", "**/storage/**", "**/shared/crypto", "**/shared/crypto.js", "**/client/**", "**/adapters/node/**"],
              message: "The Worker adapter stays on Web APIs and Durable Objects.",
            },
          ],
        },
      ],
    },
  },
);
