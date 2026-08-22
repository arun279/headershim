import { browser } from "wxt/browser";
import { webOriginFromUrl } from "../core/scope";

/**
 * Opens the options page on its About section. openOptionsPage cannot name a
 * section, and finding an already-open options tab to reuse would mean querying
 * tabs by url, which needs the "tabs" permission this extension does not ask
 * for, so each click opens a tab.
 */
export async function openAboutPage(): Promise<void> {
  await browser.tabs.create({
    url: browser.runtime.getURL("/options.html#about"),
  });
}

export async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export async function activeTabOrigin(): Promise<string | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return originFromUrl(tab?.url);
}

export function originFromUrl(url: string | undefined): string | undefined {
  return webOriginFromUrl(url)?.origin;
}
