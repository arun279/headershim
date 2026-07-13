import { type Browser, browser } from "wxt/browser";
import type { StateDoc } from "../core/model";

const STATE_KEY = "state";
const QUARANTINE_KEY = "state_quarantine";

interface StoredState {
  state: StateDoc;
}

export async function read(): Promise<StateDoc> {
  const stored = await browser.storage.local.get<StoredState>(STATE_KEY);
  return stored.state;
}

export async function readRaw(): Promise<unknown> {
  const stored =
    await browser.storage.local.get<Record<string, unknown>>(STATE_KEY);
  return stored[STATE_KEY];
}

export function quarantine(value: unknown): Promise<void> {
  return browser.storage.local.set({ [QUARANTINE_KEY]: value });
}

export function locked<T>(task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(STATE_KEY, task);
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
