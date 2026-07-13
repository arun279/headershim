import { browser } from "wxt/browser";
import type { RawRuleMatch } from "../core/matches";
import { activeTabId } from "./tabs";

export async function getMatchedRules(tabId: number): Promise<RawRuleMatch[]> {
  const result = await browser.declarativeNetRequest.getMatchedRules({ tabId });
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
 * Undefined when no web tab is active (chrome://, store pages), where there is
 * nothing to query.
 */
export async function matchedRulesForActiveTab(): Promise<
  ActiveTabMatches | undefined
> {
  const tabId = await activeTabId();
  if (tabId === undefined) {
    return undefined;
  }
  return { tabId, matches: await getMatchedRules(tabId) };
}
