import { defineConfig } from "@playwright/test";

// A loaded extension only works in a persistent context, which the fixtures own
// per test; the runner stays single-worker so the extension's service worker and
// the shared echo servers are never contended. Retries are off on purpose: a
// flaky header-modification e2e is a defect, not something to paper over.
export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Generous per-test ceiling: each test launches its own persistent context for
  // isolation, and a cold browser launch on a loaded runner can take a while.
  timeout: 90_000,
  expect: { timeout: 10_000 },
});
