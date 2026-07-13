import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // Unit and integration suites live under src/; the Playwright e2e specs in
    // e2e/ run on their own runner and must not be picked up here.
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/platform/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "src/platform/test-setup.ts",
        "src/test/**",
      ],
      thresholds: {
        "src/core/**": {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
