import { type Browser, browser } from "wxt/browser";
import type { TabOverride } from "../core/model";

const SESSION_KEY = "sessionState";
const RECONCILE_ERROR_KEY = "reconcileError";

export interface SessionState {
  nextNum: number;
  tabs: { [tabId: number]: TabOverride[] };
}

interface StoredSession {
  sessionState?: SessionState;
  reconcileError?: boolean;
}

export async function read(): Promise<SessionState> {
  const stored = await browser.storage.session.get<StoredSession>(SESSION_KEY);
  return stored.sessionState ?? { nextNum: 1, tabs: {} };
}

export function write(state: SessionState): Promise<void> {
  return browser.storage.session.set<StoredSession>({ sessionState: state });
}

export function subscribe(callback: () => void): () => void {
  return subscribeKey(SESSION_KEY, callback);
}

export function subscribeReconcileError(callback: () => void): () => void {
  return subscribeKey(RECONCILE_ERROR_KEY, callback);
}

function subscribeKey(key: string, callback: () => void): () => void {
  const listener = (changes: Record<string, Browser.storage.StorageChange>) => {
    if (key in changes) {
      callback();
    }
  };
  browser.storage.session.onChanged.addListener(listener);
  return () => browser.storage.session.onChanged.removeListener(listener);
}

export async function getReconcileError(): Promise<boolean> {
  const stored =
    await browser.storage.session.get<StoredSession>(RECONCILE_ERROR_KEY);
  return stored.reconcileError ?? false;
}

export function setReconcileError(reconcileError: boolean): Promise<void> {
  return browser.storage.session.set<StoredSession>({ reconcileError });
}
