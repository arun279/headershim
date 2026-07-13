import { browser } from "wxt/browser";
import type { RawRuleMatch } from "../core/matches";
import { activeTabId } from "./tabs";

// Chrome only drops a tab's matched-rules records once they are no longer tied
// to an active document, so a long-lived tab (an SPA left open) can still return
// matches older than the window the panel names. Bounding the query keeps the
// "last 5 min" summary literally true rather than reliant on that eviction.
const MATCH_WINDOW_MS = 5 * 60 * 1000;

export async function getMatchedRules(tabId: number): Promise<RawRuleMatch[]> {
  const result = await browser.declarativeNetRequest.getMatchedRules({
    tabId,
    minTimeStamp: Date.now() - MATCH_WINDOW_MS,
  });
  return result.rulesMatchedInfo;
}

export interface ActiveTabMatches {
  readonly tabId: number;
  readonly matches: RawRuleMatch[];
}

/**
 * The Verify entry point. The popup click is the activeTab gesture, so the
 * active tab is resolved and its matched-rules record fetched with the tab id
 * passed explicitly: under activeTab, the argument-free form throws a
 * permission error and only the `{tabId}` form succeeds (Chrome 150).
 * Undefined when there is nothing to query: no active tab, or a restricted tab
 * (chrome://, the Web Store) where activeTab host access is never granted and
 * the query rejects.
 */
export async function matchedRulesForActiveTab(): Promise<
  ActiveTabMatches | undefined
> {
  const tabId = await activeTabId();
  if (tabId === undefined) {
    return undefined;
  }
  try {
    return { tabId, matches: await getMatchedRules(tabId) };
  } catch {
    return undefined;
  }
}
