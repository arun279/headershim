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
      args: ["--ignore-certificate-errors"],
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

// When the service worker never appears the extension did not install. Dump what
// Chrome itself saw — the managed policy it read and its extension records with
// any install error — so the next failure explains itself instead of only timing
// out. Everything here is best-effort and only runs on the failure path.
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

  for (const url of ["chrome://policy", "chrome://extensions-internals"]) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "load", timeout: 15_000 });
      await page.waitForTimeout(1_000);
      // chrome:// pages render inside nested shadow roots, so pierce them to
      // collect the policy values and extension records as plain text.
      const text = await page.evaluate(() => {
        const chunks: string[] = [];
        const visit = (root: ParentNode): void => {
          for (const element of Array.from(
            root.querySelectorAll<HTMLElement>("*"),
          )) {
            const shadow = element.shadowRoot;
            if (shadow !== null) {
              chunks.push(shadow.textContent ?? "");
              visit(shadow);
            }
          }
        };
        visit(document);
        chunks.push(document.body?.innerText ?? "");
        return chunks.filter(Boolean).join("\n");
      });
      section(url, text.trim() || "(no text extracted)");
    } catch (error) {
      section(url, `failed to capture: ${(error as Error).message}`);
    } finally {
      await page.close();
    }
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
