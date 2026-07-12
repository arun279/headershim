import { defineConfig } from "wxt";

export default defineConfig({
  vite: () => ({
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "preact",
    },
  }),
  manifest: {
    permissions: [
      "declarativeNetRequestWithHostAccess",
      "storage",
      "activeTab",
      "tabs",
    ],
    optional_host_permissions: ["*://*/*"],
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
