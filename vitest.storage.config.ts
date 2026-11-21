import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "storage",
    environment: "node",
    include: ["test/storage/**/*.test.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
