import { mkdtemp, rm } from "node:fs/promises";
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
      args: ["--ignore-certificate-errors"],
    });
    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 60_000 }));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

export { expect } from "@playwright/test";
export { getDynamicRules, readEcho, seedState } from "../fixtures";

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
