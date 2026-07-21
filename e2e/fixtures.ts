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
import {
  compileDynamic,
  compileSession,
  type DnrRule,
} from "../src/core/compile";
import {
  createRule,
  type RuleDraft,
  type StateDoc,
  type TabOverride,
} from "../src/core/model";
import { planReconcile } from "../src/core/reconcile";
import { createV1Seed } from "../src/core/schema";
import {
  type EchoServers,
  spawnEchoServers,
  stopEchoServers,
} from "./echo-servers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ExtensionBuildOptions {
  extensionBuild: "host-access" | "shipped";
}

interface WorkerFixtures {
  echoServers: EchoServers;
}

interface TestFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<
  ExtensionBuildOptions & TestFixtures,
  WorkerFixtures
>({
  extensionBuild: ["shipped", { option: true }],
  echoServers: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright resolves fixture dependencies from this parameter's destructuring; it declares none.
    async ({}, use) => {
      const { servers, child } = await spawnEchoServers();
      await use(servers);
      await stopEchoServers(child);
    },
    { scope: "worker" },
  ],

  context: async ({ extensionBuild }, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "headershim-e2e-"));
    const { HEADED } = process.env;
    const extensionPath = path.join(
      root,
      ".output",
      extensionBuild === "host-access"
        ? "chrome-mv3-e2e-hostaccess"
        : "chrome-mv3",
    );
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

interface SessionSeed {
  nextNum: number;
  tabs: { [tabId: number]: TabOverride[] };
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
    throw new Error("no active tab to derive a tab id from");
  }
  return id;
}

export async function getSessionRules(worker: Worker): Promise<DnrRule[]> {
  const rules = await worker.evaluate(() =>
    chrome.declarativeNetRequest.getSessionRules(),
  );
  return rules as DnrRule[];
}

function seedSession(worker: Worker, seed: SessionSeed): Promise<void> {
  // Same "state" lock the background holds around its session pruning, so a
  // seed cannot interleave with an in-flight onUpdated/onRemoved cleanup.
  return worker.evaluate(
    (s) =>
      navigator.locks.request("state", () =>
        chrome.storage.session.set({ sessionState: s }),
      ),
    seed,
  );
}

export async function seedSessionAndWait(
  worker: Worker,
  overrides: readonly TabOverride[],
): Promise<DnrRule[]> {
  const desired = compileSession(overrides, false);
  const tabs: { [tabId: number]: TabOverride[] } = {};
  for (const override of overrides) {
    const rows = tabs[override.tabId] ?? [];
    rows.push(override);
    tabs[override.tabId] = rows;
  }
  const nextNum = overrides.reduce((max, o) => Math.max(max, o.num), 0) + 1;
  await seedSession(worker, { nextNum, tabs });
  await expect
    .poll(
      async () =>
        planReconcile(desired, await getSessionRules(worker)) === null,
    )
    .toBe(true);
  return desired;
}

export function getBadgeText(worker: Worker, tabId?: number): Promise<string> {
  return worker.evaluate(
    (id) => chrome.action.getBadgeText(id === null ? {} : { tabId: id }),
    tabId ?? null,
  );
}

export function getBadgeColor(
  worker: Worker,
): Promise<[number, number, number, number]> {
  return worker.evaluate(() => chrome.action.getBadgeBackgroundColor({}));
}

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
  cache?: "default" | "reload";
  headers?: Record<string, string>;
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
