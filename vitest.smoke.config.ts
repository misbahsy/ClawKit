import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 120000,
    include: ["tests/smoke/**/*.test.ts"],
    alias: {
      "clawkit:types": resolve(__dirname, "packages/core/src/types.ts"),
    },
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
