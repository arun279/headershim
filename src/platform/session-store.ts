import { type Browser, browser } from "wxt/browser";
import type { TabOverride } from "../core/model";
import type { RulesRevision } from "../core/revision";
import { isRecord, isTabOverride } from "../core/validation";

const SESSION_KEY = "sessionState";
const APPLIED_KEY = "appliedRules";

export interface SessionState {
  nextNum: number;
  tabs: { [tabId: number]: TabOverride[] };
}

interface StoredSession {
  sessionState?: SessionState;
  appliedRules?: RulesRevision;
}

export async function read(): Promise<SessionState> {
  const stored = await browser.storage.session.get<StoredSession>(SESSION_KEY);
  const session = stored.sessionState;
  if (!isRecord(session)) {
    return { nextNum: 1, tabs: {} };
  }
  const tabs = isRecord(session.tabs)
    ? Object.fromEntries(
        Object.entries(session.tabs).flatMap(([tabId, rows]) =>
          Array.isArray(rows) ? [[tabId, rows.filter(isTabOverride)]] : [],
        ),
      )
    : {};
  const maxNum = Object.values(tabs)
    .flat()
    .reduce((max, { num }) => Math.max(max, num), 0);
  return {
    nextNum:
      Number.isSafeInteger(session.nextNum) && session.nextNum > maxNum
        ? session.nextNum
        : maxNum + 1,
    tabs,
  };
}

export function write(state: SessionState): Promise<void> {
  return browser.storage.session.set<StoredSession>({ sessionState: state });
}

/** Drops every tab's overrides; the background reconciles the session rules away. */
export function clearOverrides(): Promise<void> {
  return browser.storage.session.remove(SESSION_KEY);
}

export function subscribe(callback: () => void): () => void {
  return subscribeKey(SESSION_KEY, callback);
}

export function subscribeAppliedRevision(callback: () => void): () => void {
  return subscribeKey(APPLIED_KEY, callback);
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

export async function getAppliedRevision(): Promise<RulesRevision | undefined> {
  const stored = await browser.storage.session.get<StoredSession>(APPLIED_KEY);
  return stored.appliedRules;
}

export function setAppliedRevision(revision: RulesRevision): Promise<void> {
  return browser.storage.session.set<StoredSession>({
    appliedRules: revision,
  });
}

export function clearAppliedRevision(): Promise<void> {
  return browser.storage.session.remove(APPLIED_KEY);
}
