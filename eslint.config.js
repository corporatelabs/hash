import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".wrangler/**", "vendor/**", "worker-configuration.d.ts", "coverage/**", "data/**"],
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
    files: ["src/core/**/*.ts", "src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "cloudflare:*",
                "@cloudflare/*",
                "wrangler",
                "wrangler/*",
                "better-sqlite3",
                "ioredis",
                "hash-wasm",
                "**/adapters/**",
                "**/storage/**",
              ],
              message: "Core and shared crypto stay free of Cloudflare, Wrangler, adapters, and storage backends.",
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
