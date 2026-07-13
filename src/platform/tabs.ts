import { browser } from "wxt/browser";

export async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/**
 * Domain of the tab the popup was opened on, for pre-filling a new rule's
 * scope. Undefined on chrome:// pages, store pages, and anywhere else the
 * URL is unavailable or not a web origin.
 */
export async function activeTabDomain(): Promise<string | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return domainFromUrl(tab?.url);
}

export function domainFromUrl(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "https:" || protocol === "http:") && hostname !== ""
      ? hostname
      : undefined;
  } catch {
    return undefined;
  }
}
