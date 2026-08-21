import { defineConfig } from "vitest/config";

// Standalone config so `pnpm test` works inside workers/ with its own
// vitest installation instead of relying on the root workspace runner.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Contract tests import main-package source via relative paths
    // (../../src/utils/compression); Vitest resolves those as plain files,
    // so no alias is required.
  },
});
