import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  type Page,
  type Worker,
} from "@playwright/test";
import {
  type EchoServers,
  spawnEchoServers,
  stopEchoServers,
} from "../echo-servers";

interface WorkerFixtures {
  echoServers: EchoServers;
}

interface TestFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

// Chrome writes its own install/updater diagnostics here; the failure-path dump
// reads it back to explain why the force-installed extension never appeared.
const chromeLogPath = path.join(tmpdir(), "headershim-packed-chrome.log");

// The gate runs against Google Chrome (channel:'chrome'), which is the only
// build that reads /etc/opt/chrome/policies/managed. The extension is not loaded
// with --load-extension: the machine policy force-installs the packed CRX from
// the local update server, so the whole install path matches the store shape.
export const test = base.extend<TestFixtures, WorkerFixtures>({
  echoServers: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright resolves fixture dependencies from this parameter's destructuring; it declares none.
    async ({}, use) => {
      const { servers, child } = await spawnEchoServers();
      await use(servers);
      await stopEchoServers(child);
    },
    { scope: "worker" },
  ],

  // biome-ignore lint/correctness/noEmptyPattern: Playwright resolves fixture dependencies from this parameter's destructuring; it declares none.
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(
      path.join(tmpdir(), "headershim-packed-"),
    );
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      // A force-installed extension's service worker does not reliably start in
      // headless Chrome, so the gate runs headed under Xvfb on CI.
      headless: false,
      // Playwright's defaults break the force-install path: --disable-extensions
      // turns the extension system off entirely, and the two networking flags stop
      // Chrome from fetching the CRX from the update server the managed policy
      // points at. Without them removed the extension never installs and no
      // service worker starts.
      ignoreDefaultArgs: [
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
      ],
      args: [
        "--ignore-certificate-errors",
        // Log Chrome's extension updater/installer so a failed force-install is
        // diagnosable from the log file instead of an opaque timeout.
        "--enable-logging",
        `--log-file=${chromeLogPath}`,
        "--vmodule=extension_downloader=2,extension_updater=2,crx_installer=2,sandboxed_unpacker=2",
      ],
    });
    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (worker === undefined) {
      try {
        worker = await context.waitForEvent("serviceworker", {
          timeout: 60_000,
        });
      } catch (error) {
        await dumpInstallDiagnostics(context);
        throw error;
      }
    }
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

export { expect } from "@playwright/test";
export { getDynamicRules, readEcho, seedState } from "../fixtures";

// When the service worker never appears the extension did not install. Enumerate
// the extension records Chrome holds and replay its updater/installer log so the
// next failure explains itself instead of only timing out. Best-effort and only
// runs on the failure path.
async function dumpInstallDiagnostics(context: BrowserContext): Promise<void> {
  const section = (label: string, body: string) =>
    console.error(`\n===== ${label} =====\n${body}\n`);

  section(
    "live targets",
    JSON.stringify(
      {
        serviceWorkers: context.serviceWorkers().map((w) => w.url()),
        backgroundPages: context.backgroundPages().map((p) => p.url()),
        pages: context.pages().map((p) => p.url()),
      },
      null,
      2,
    ),
  );

  const page = await context.newPage();
  try {
    await page.goto("chrome://extensions-internals", {
      waitUntil: "load",
      timeout: 15_000,
    });
    await page.waitForTimeout(1_000);
    const records = await page.evaluate(() => document.body?.innerText ?? "");
    section("chrome://extensions-internals", records.trim() || "(no records)");
  } catch (error) {
    section(
      "chrome://extensions-internals",
      `failed: ${(error as Error).message}`,
    );
  } finally {
    await page.close();
  }

  try {
    const log = await readFile(chromeLogPath, "utf8");
    const lines = log
      .split("\n")
      .filter((line) => /extension|crx|updat|download|install|8730/i.test(line))
      .slice(-60)
      .join("\n");
    section("chrome log (install/updater)", lines || "(no matching lines)");
  } catch (error) {
    section(
      "chrome log (install/updater)",
      `unreadable: ${(error as Error).message}`,
    );
  }
}

// activeTab is only granted when the user invokes the extension. The
// _execute_action command (Alt+Shift+H in the manifest) is the one gesture
// Playwright can synthesize; opening the popup grants activeTab for the tab the
// gesture came from.
export async function grantActiveTabViaCommand(page: Page): Promise<void> {
  await page.bringToFront();
  await page.keyboard.press("Alt+Shift+H");
}

export function getMatchedRuleIds(
  worker: Worker,
  tabId: number,
): Promise<number[]> {
  return worker.evaluate(async (id) => {
    const { rulesMatchedInfo } =
      await chrome.declarativeNetRequest.getMatchedRules({ tabId: id });
    return rulesMatchedInfo.map((match) => match.rule.ruleId);
  }, tabId);
}

export async function activeTabId(worker: Worker): Promise<number> {
  const id = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return tab?.id;
  });
  if (id === undefined) {
    throw new Error("no active tab id after the activeTab gesture");
  }
  return id;
}
