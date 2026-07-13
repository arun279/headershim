import { type Browser, browser } from "wxt/browser";
import type { StateDoc } from "../core/model";

const STATE_KEY = "state";

interface StoredState {
  state: StateDoc;
}

export async function read(): Promise<StateDoc> {
  const stored = await browser.storage.local.get<StoredState>(STATE_KEY);
  return stored.state;
}

export function write(doc: StateDoc): Promise<void> {
  return browser.storage.local.set<StoredState>({ state: doc });
}

export function subscribe(callback: () => void): () => void {
  const listener = (changes: Record<string, Browser.storage.StorageChange>) => {
    if (STATE_KEY in changes) {
      callback();
    }
  };
  browser.storage.local.onChanged.addListener(listener);
  return () => browser.storage.local.onChanged.removeListener(listener);
}
