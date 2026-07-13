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
  const listener = () => callback();
  browser.permissions.onAdded.addListener(listener);
  browser.permissions.onRemoved.addListener(listener);
  return () => {
    browser.permissions.onAdded.removeListener(listener);
    browser.permissions.onRemoved.removeListener(listener);
  };
}
