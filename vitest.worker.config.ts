import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ENVIRONMENT: "test",
          RATE_LIMIT_PEPPER: "development-only-pepper",
        },
      },
    }),
  ],
  test: {
    include: ["test/worker/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
