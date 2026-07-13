import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type Worker,
} from "@playwright/test";
import { compileDynamic, type DnrRule } from "../src/core/compile";
import { createRule, type RuleDraft, type StateDoc } from "../src/core/model";
import { planReconcile } from "../src/core/reconcile";
import { createV1Seed } from "../src/core/schema";
import {
  type EchoServers,
  spawnEchoServers,
  stopEchoServers,
} from "./echo-servers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, ".output", "chrome-mv3");

interface WorkerFixtures {
  echoServers: EchoServers;
}

interface TestFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

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
    const userDataDir = await mkdtemp(path.join(tmpdir(), "headershim-e2e-"));
    const { HEADED } = process.env;
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      // Try pure headless first (the harness proves it works); flip via HEADED=1
      // for local debugging or the Xvfb-headed CI fallback.
      headless: HEADED !== "1",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // The h2 echo server presents a throwaway self-signed cert.
        "--ignore-certificate-errors",
      ],
    });
    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

export { expect };

export const ON_WIRE_GRANT_UNAVAILABLE =
  "Chrome exposes no automatable grant for the optional wildcard host permission in headless mode for this manifest posture; the on-wire assertion requires a grant that grantAllSitesViaDetails could not obtain (see e2e/README.md).";

export const DUAL_GRANT_TRANSITION_UNAVAILABLE =
  "Chrome exposes no automatable per-origin grant in headless mode for this unpacked manifest posture, so the harness cannot establish the destination-only starting state required to add the initiator grant (see e2e/README.md).";

export function stateWithRules(drafts: readonly RuleDraft[]): StateDoc {
  let doc = createV1Seed();
  const rules = drafts.map((draft) => {
    const [rule, next] = createRule(doc, draft);
    doc = next;
    return rule;
  });
  const [profile] = doc.profiles;
  if (profile === undefined) {
    throw new Error("seed document is missing its Default profile");
  }
  return { ...doc, profiles: [{ ...profile, rules }] };
}

export function seedState(worker: Worker, doc: StateDoc): Promise<void> {
  // Take the same "state" lock the background holds around its recovery and
  // migration writes; a bare set can otherwise interleave with an in-flight
  // recovery on a fresh profile and get clobbered by the reseeded default.
  return worker.evaluate(
    (d) =>
      navigator.locks.request("state", () =>
        chrome.storage.local.set({ state: d }),
      ),
    doc,
  );
}

export async function seedStateAndWait(
  worker: Worker,
  doc: StateDoc,
): Promise<DnrRule[]> {
  const desired = compileDynamic(doc);
  await seedState(worker, doc);
  await expect
    .poll(
      async () =>
        planReconcile(desired, await getDynamicRules(worker)) === null,
    )
    .toBe(true);
  return desired;
}

export async function getDynamicRules(worker: Worker): Promise<DnrRule[]> {
  const rules = await worker.evaluate(() =>
    chrome.declarativeNetRequest.getDynamicRules(),
  );
  return rules as DnrRule[];
}

export async function readEcho(page: Page): Promise<Record<string, string>> {
  const text = await page.locator("#echo").textContent();
  return JSON.parse(text ?? "{}") as Record<string, string>;
}

export interface EchoFetchInit {
  body?: string;
  cache?: "default" | "reload";
  headers?: Record<string, string>;
  method?: "GET" | "POST";
}

export interface EchoFetchResult {
  responseHeaders: Record<string, string>;
  requestCount?: number;
  requestHeaders: Record<string, string>;
  status: number;
}

export function fetchEcho(
  page: Page,
  url: string,
  init: EchoFetchInit = {},
): Promise<EchoFetchResult> {
  return page.evaluate(
    async ({ requestUrl, requestInit }) => {
      const response = await fetch(requestUrl, requestInit);
      const payload = (await response.json()) as {
        headers: Record<string, string>;
        requestCount?: number;
      };
      return {
        responseHeaders: Object.fromEntries(response.headers.entries()),
        ...(payload.requestCount === undefined
          ? {}
          : { requestCount: payload.requestCount }),
        requestHeaders: payload.headers,
        status: response.status,
      };
    },
    { requestUrl: url, requestInit: init },
  );
}

// Drives the extension's own Details page to grant the optional wildcard host
// permission. Returns whether the grant actually landed — see e2e/README.md for
// why it currently does not in headless Chromium for this permission posture.
export async function grantAllSitesViaDetails(
  context: BrowserContext,
  extensionId: string,
  worker: Worker,
): Promise<boolean> {
  await toggleAllSitesViaDetails(context, extensionId);
  return worker.evaluate(() =>
    chrome.permissions.contains({ origins: ["*://*/*"] }),
  );
}

export async function toggleAllSitesViaDetails(
  context: BrowserContext,
  extensionId: string,
): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extensionId}`);
  const toggle = page.locator("extensions-toggle-row#allHostsToggle cr-toggle");
  await toggle.waitFor({ state: "attached" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
  }
  await page.close();
}
