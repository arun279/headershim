import { execSync } from "node:child_process";
import { defineConfig } from "wxt";
import { BRAND_NAME } from "./src/brand";

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
  }),
  manifest: {
    // The single display name (chrome://extensions, the install prompt, the
    // store card); without it WXT falls back to the lowercase package id.
    name: BRAND_NAME,
    // The highest-versioned API the extension actually calls is
    // action.setBadgeTextColor (Chrome 110); every other version-gated API it
    // uses lands earlier (requestDomains/initiatorDomains 101, storage.session
    // 102, displayActionCountAsBadgeText 88, isRegexSupported 87, modifyHeaders
    // 86). The larger session-rule cap and storage.session quota are platform
    // values HeaderShim stays well under, so they don't raise the floor.
    minimum_chrome_version: "110",
    permissions: [
      "declarativeNetRequestWithHostAccess",
      "storage",
      "activeTab",
    ],
    ...(e2eHostAccess ? { host_permissions: ["*://*/*"] } : {}),
    optional_host_permissions: ["*://*/*"],
    // The default tooltip; the badge state machine swaps in "HeaderShim — paused"
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
