import { defineConfig } from "@playwright/test";

// The packed-build gate runs Google Chrome with a machine-installed
// force-install policy, so it is separate from the unpacked e2e config: a
// single worker, no retries (a flaky gate is a defect), and a global setup that
// serves the packed CRX to the policy for the run's lifetime. The specs skip
// themselves off Linux; see e2e/packed and e2e/README.md.
export default defineConfig({
  testDir: "./e2e/packed",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/packed/global-setup.mjs",
});
