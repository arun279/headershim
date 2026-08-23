import { browser } from "wxt/browser";
import { webOriginFromUrl } from "../core/scope";

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
