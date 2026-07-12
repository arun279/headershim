import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "src/test/**"],
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
