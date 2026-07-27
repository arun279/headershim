import { defineConfig } from "@playwright/test";

interface ExtensionBuildOptions {
  extensionBuild: "host-access" | "narrow-host-access" | "shipped";
}

const hostAccessTag = /@host-access/;
const narrowHostAccessTag = /@narrow-host-access/;

// A loaded extension only works in a persistent context, so the fixtures give
// each test a fresh profile directory and each worker its own echo servers, and
// the run takes the default worker count. The narrow-host-access project is the
// one place two workers would want the same resource, and it caps itself below.
// Locally retries stay off so a genuine header-modification defect surfaces
// immediately; CI gets a modest backstop for the inherently eventual browser
// operations (DNR propagation, focus/render) that only misbehave under load, on
// top of the per-condition polling the specs already do.
export default defineConfig<ExtensionBuildOptions>({
  testDir: "./e2e/specs",
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
      grepInvert: [hostAccessTag, narrowHostAccessTag],
      use: { extensionBuild: "shipped" },
    },
    {
      name: "host-access",
      grep: hostAccessTag,
      use: { extensionBuild: "host-access" },
    },
    {
      name: "narrow-host-access",
      grep: narrowHostAccessTag,
      // This build's manifest names a literal origin, so its HTTP/1.1 echo
      // server has to bind that exact port instead of an ephemeral one. One
      // worker keeps the project from ever binding it twice at once.
      workers: 1,
      use: { extensionBuild: "narrow-host-access" },
    },
  ],
});
