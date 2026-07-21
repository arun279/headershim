import { defineConfig } from "@playwright/test";

interface ExtensionBuildOptions {
  extensionBuild: "host-access" | "shipped";
}

const hostAccessTag = /@host-access/;

// A loaded extension only works in a persistent context, which the fixtures own
// per test; the runner stays single-worker so the extension's service worker and
// the shared echo servers are never contended. Locally retries stay off so a
// genuine header-modification defect surfaces immediately; CI gets a modest
// backstop for the inherently eventual browser operations (DNR propagation,
// focus/render) that only misbehave under load, on top of the per-condition
// polling the specs already do.
export default defineConfig<ExtensionBuildOptions>({
  testDir: "./e2e/specs",
  fullyParallel: false,
  workers: 1,
  // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature; TS noPropertyAccessFromIndexSignature requires bracket access
  retries: process.env["CI"] ? 2 : 0,
  reporter: [["list"]],
  // Generous per-test ceiling: each test launches its own persistent context for
  // isolation, and a cold browser launch on a loaded runner can take a while.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: "shipped",
      grepInvert: hostAccessTag,
      use: { extensionBuild: "shipped" },
    },
    {
      name: "host-access",
      grep: hostAccessTag,
      use: { extensionBuild: "host-access" },
    },
  ],
});
