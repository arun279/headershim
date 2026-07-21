import type { KnipConfig } from "knip";

export default {
  entry: [
    "src/**/*.test.ts",
    "e2e/specs/**/*.spec.ts",
    "e2e/packed/**/*.spec.ts",
    "e2e/packed/{pack,update-server,policy,selfcheck}.mjs",
    "scripts/echo-server.mjs",
    // Loaded synchronously from both extension-page heads before UI modules.
    "public/theme-bootstrap.js",
  ],
  // Tests are entry points above, which is what lets knip see the whole repo —
  // but it also means a module stays "used" for as long as a test imports it,
  // so dead production code with a live test is invisible. `knip --production`
  // closes that: it drops every pattern without a `!` suffix, leaving only what
  // the shipped WXT entrypoints actually reach. The negations below keep the
  // test harnesses and build scripts out of that pass. They have real callers;
  // they just never ship.
  //
  // That pass is gated on `--include files` only. Dropping the test entry points
  // also drops the only importer of every export a test reaches for, so the
  // export report there flags test-only surface (`store.read`, `sentenceText`)
  // as unused. Files carry no such ambiguity: nothing shipped reaches them.
  project: [
    "**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
    "!e2e/**!",
    "!scripts/**!",
    "!src/test/**!",
    "!src/ui/test/**!",
    "!**/*.test.{ts,tsx}!",
    "!**/test-*.ts!",
    "!**/*.fake.ts!",
  ],
  // The packed suite runs off a second Playwright config; without this the
  // plugin only discovers the default one.
  playwright: {
    config: ["playwright.config.ts", "playwright.packed.config.ts"],
  },
  // The h2 echo server shells out to the system openssl to mint a throwaway cert.
  ignoreBinaries: ["openssl"],
} satisfies KnipConfig;
