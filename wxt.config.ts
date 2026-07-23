import { execSync } from "node:child_process";
import { defineConfig } from "wxt";
import { BRAND_NAME } from "./src/brand";
import { ALL_SITES_ORIGIN, MANIFEST_PERMISSIONS } from "./src/core/grants";
import { MINIMUM_CHROME_VERSION } from "./src/core/limits";

// E2E traffic checks need a host grant that Chromium cannot grant through its
// native optional-permission prompt in headless mode. This flag produces a
// separate unpacked artifact with static access; the default shipped artifact
// keeps its optional-only permission posture.
// biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature; TS noPropertyAccessFromIndexSignature requires bracket access
const e2eHostAccess = process.env["E2E_HOST_ACCESS"] === "1";

// The trust page displays the commit each build came from; a
// release build is always a git checkout, so the working tree is the source.
function commitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  ...(e2eHostAccess ? { outDirTemplate: "chrome-mv3-e2e-hostaccess" } : {}),
  vite: () => ({
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "preact",
    },
    define: {
      __COMMIT__: JSON.stringify(commitHash()),
    },
    // Vite's preload polyfill fetches each module it warms, and it is the only
    // fetch() the bundle would contain. connect-src 'none' blocks it at runtime,
    // so drop the polyfill rather than ship a call that can only fail.
    build: { modulePreload: { polyfill: false } },
  }),
  manifest: {
    // The single display name (chrome://extensions, the install prompt, the
    // store card); without it WXT falls back to the lowercase package id.
    name: BRAND_NAME,
    // Chrome 120 split dynamic and session rules into separate limits. Earlier
    // versions share a 5,000-rule cap that cannot hold both product maxima.
    minimum_chrome_version: String(MINIMUM_CHROME_VERSION),
    // The same list the About page draws its disclosure rows from, so the
    // product cannot declare a permission it does not explain.
    permissions: [...MANIFEST_PERMISSIONS],
    ...(e2eHostAccess ? { host_permissions: [ALL_SITES_ORIGIN] } : {}),
    optional_host_permissions: [ALL_SITES_ORIGIN],
    // HeaderShim reads and writes headers through declarativeNetRequest and
    // opens no connection of its own. connect-src 'none' is the
    // browser-enforced half of that: it blocks fetch, XHR, WebSocket,
    // EventSource, and sendBeacon from every extension page and the worker, and
    // says nothing about images, media, fonts, frames, forms, or navigations.
    // The other half is the built files, which carry no call written to any of
    // them; scripts/check-no-network.mjs holds that half against the artifact,
    // and states there what a call-shape scan does and does not cover.
    // The rest matches Chrome's default extension_pages policy.
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'none';",
    },
    // The default tooltip; the badge state machine swaps in its paused title
    // while paused and clears back to this on exit.
    action: { default_title: BRAND_NAME },
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+H" },
        description: "Open the popup",
      },
      "toggle-pause": {
        suggested_key: { default: "Alt+Shift+P" },
        description: "Toggle global pause",
      },
      "next-profile": {
        suggested_key: { default: "Alt+Shift+K" },
        description: "Switch to next profile",
      },
    },
    icons: {
      16: "icon/icon-16.png",
      32: "icon/icon-32.png",
      48: "icon/icon-48.png",
      128: "icon/icon-128.png",
    },
  },
});
