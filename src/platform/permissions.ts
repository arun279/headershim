import { browser } from "wxt/browser";
import { ALL_SITES_ORIGIN, type GrantSnapshot } from "../core/grants";

const ALL_URL_PATTERNS = new Set([ALL_SITES_ORIGIN, "<all_urls>"]);

export interface HostAccessRequest {
  documentId?: string;
  pattern?: string;
  tabId?: number;
}

export async function snapshot(): Promise<GrantSnapshot> {
  const granted = await browser.permissions.getAll();
  const origins = granted.origins ?? [];
  return {
    origins,
    // Broad grants need an explicit flag because core containment is domain-based.
    allSites: origins.some((origin) => ALL_URL_PATTERNS.has(origin)),
  };
}

export function contains(origins: string[]): Promise<boolean> {
  return browser.permissions.contains({ origins });
}

export function request(origins: string[]): Promise<boolean> {
  return browser.permissions.request({ origins });
}

export function remove(origins: string[]): Promise<boolean> {
  return browser.permissions.remove({ origins });
}

export function onChanged(callback: () => void): () => void {
  const listener = () => callback();
  browser.permissions.onAdded.addListener(listener);
  browser.permissions.onRemoved.addListener(listener);
  return () => {
    browser.permissions.onAdded.removeListener(listener);
    browser.permissions.onRemoved.removeListener(listener);
  };
}

export function addHostAccessRequest(
  request: HostAccessRequest,
): Promise<void> {
  const addRequest = browser.permissions.addHostAccessRequest;
  if (typeof addRequest !== "function") {
    return Promise.resolve();
  }
  return addRequest(request);
}
