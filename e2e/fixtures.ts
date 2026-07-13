import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  test as base,
  chromium,
  type Page,
  type Worker,
} from "@playwright/test";
import type { DnrRule } from "../src/core/compile";
import type { StateDoc } from "../src/core/model";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, ".output", "chrome-mv3");
const echoServerScript = path.join(root, "scripts", "echo-server.mjs");

export interface EchoServers {
  h1Url: string;
  h2Url: string;
}

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

export { expect } from "@playwright/test";

export function seedState(worker: Worker, doc: StateDoc): Promise<void> {
  return worker.evaluate((d) => chrome.storage.local.set({ state: d }), doc);
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

// Drives the extension's own Details page to grant the optional wildcard host
// permission. Returns whether the grant actually landed — see e2e/README.md for
// why it currently does not in headless Chromium for this permission posture.
export async function grantAllSitesViaDetails(
  context: BrowserContext,
  extensionId: string,
  worker: Worker,
): Promise<boolean> {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extensionId}`);
  const toggle = page.locator("extensions-toggle-row#allHostsToggle cr-toggle");
  await toggle.waitFor({ state: "attached" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
  }
  await page.close();
  return worker.evaluate(() =>
    chrome.permissions.contains({ origins: ["*://*/*"] }),
  );
}

async function spawnEchoServers(): Promise<{
  servers: EchoServers;
  child: ChildProcess;
}> {
  const child = spawn(process.execPath, [echoServerScript], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const servers = await new Promise<EchoServers>((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        child.stdout?.off("data", onData);
        resolve(JSON.parse(buffer.slice(0, newline)) as EchoServers);
      }
    };
    child.stdout?.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`echo server exited before ready (code ${code})`)),
    );
  });
  return { servers, child };
}

function stopEchoServers(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
