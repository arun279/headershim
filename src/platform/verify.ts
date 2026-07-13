import { browser } from "wxt/browser";
import type { RawRuleMatch } from "../core/matches";

export async function getMatchedRules(tabId: number): Promise<RawRuleMatch[]> {
  const result = await browser.declarativeNetRequest.getMatchedRules({ tabId });
  return result.rulesMatchedInfo;
}
