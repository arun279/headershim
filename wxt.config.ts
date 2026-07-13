import { execSync } from "node:child_process";
import { defineConfig } from "wxt";

// The trust page displays the commit each build came from (SPEC §4.2); a
// release build is always a git checkout, so the working tree is the source.
function commitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
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
    permissions: [
      "declarativeNetRequestWithHostAccess",
      "storage",
      "activeTab",
    ],
    optional_host_permissions: ["*://*/*"],
    // The default tooltip; the badge state machine swaps in "headershim — paused"
    // while paused and clears back to this on exit (SPEC §4.4).
    action: { default_title: "headershim" },
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+H" },
        description: "Open the popup",
      },
      "toggle-pause": {
        suggested_key: { default: "Alt+Shift+P" },
        description: "Toggle global pause",
      },
      verify: {
        suggested_key: { default: "Alt+Shift+V" },
        description: "Run Verify on the current tab",
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
