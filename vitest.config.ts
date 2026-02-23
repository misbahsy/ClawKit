import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    alias: {
      "clawkit:types": resolve(__dirname, "packages/core/src/types.ts"),
    },
  },
});
