import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { RawRuleMatch } from "../core/matches";
import { getMatchedRules } from "./verify";

describe("verify adapter", () => {
  it("fetches raw matches with an explicit tab id", async () => {
    const match: RawRuleMatch = {
      rule: { ruleId: 12, rulesetId: "_dynamic" },
      tabId: 91,
      timeStamp: 1_234,
    };
    const getRules = vi
      .spyOn(browser.declarativeNetRequest, "getMatchedRules")
      .mockImplementation(async () => ({ rulesMatchedInfo: [match] }));

    await expect(getMatchedRules(91)).resolves.toEqual([match]);
    expect(getRules).toHaveBeenCalledWith({ tabId: 91 });
  });
});
