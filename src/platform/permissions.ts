import { browser } from "wxt/browser";
import { type GrantSnapshot, isAllSitesOrigin } from "../core/grants";

export async function snapshot(): Promise<GrantSnapshot> {
  const granted = await browser.permissions.getAll();
  const origins = granted.origins ?? [];
  return {
    origins,
    // Broad grants need an explicit flag because core containment is domain-based.
    allSites: origins.some(isAllSitesOrigin),
  };
}

export function request(origins: string[]): Promise<boolean> {
  return browser.permissions.request({ origins });
}

export function remove(origins: string[]): Promise<boolean> {
  return browser.permissions.remove({ origins });
}

export function onChanged(callback: () => void): () => void {
  browser.permissions.onAdded.addListener(callback);
  browser.permissions.onRemoved.addListener(callback);
  return () => {
    browser.permissions.onAdded.removeListener(callback);
    browser.permissions.onRemoved.removeListener(callback);
  };
}
