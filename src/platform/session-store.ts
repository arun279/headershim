import { browser } from "wxt/browser";
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

export async function getReconcileError(): Promise<boolean> {
  const stored =
    await browser.storage.session.get<StoredSession>(RECONCILE_ERROR_KEY);
  return stored.reconcileError ?? false;
}

export function setReconcileError(reconcileError: boolean): Promise<void> {
  return browser.storage.session.set<StoredSession>({ reconcileError });
}
