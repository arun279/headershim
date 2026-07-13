import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { RawRuleMatch } from "../core/matches";
import { getMatchedRules, matchedRulesForActiveTab } from "./verify";

const match: RawRuleMatch = {
  rule: { ruleId: 12, rulesetId: "_dynamic" },
  tabId: 91,
  timeStamp: 1_234,
};

describe("verify adapter", () => {
  it("fetches raw matches with an explicit tab id", async () => {
    const getRules = vi
      .spyOn(browser.declarativeNetRequest, "getMatchedRules")
      .mockImplementation(async () => ({ rulesMatchedInfo: [match] }));

    await expect(getMatchedRules(91)).resolves.toEqual([match]);
    expect(getRules).toHaveBeenCalledWith({ tabId: 91 });
  });

  it("resolves the active tab and queries it by id under the gesture", async () => {
    vi.spyOn(browser.tabs, "query").mockImplementation(
      async () => [{ id: 91, url: "https://example.com/" }] as never,
    );
    const getRules = vi
      .spyOn(browser.declarativeNetRequest, "getMatchedRules")
      .mockImplementation(async () => ({ rulesMatchedInfo: [match] }));

    await expect(matchedRulesForActiveTab()).resolves.toEqual({
      tabId: 91,
      matches: [match],
    });
    expect(getRules).toHaveBeenCalledWith({ tabId: 91 });
    // The zero-argument form throws under activeTab; it must never be reached.
    expect(getRules).not.toHaveBeenCalledWith();
  });

  it("does not query matched rules when no web tab is active", async () => {
    vi.spyOn(browser.tabs, "query").mockImplementation(async () => []);
    const getRules = vi.spyOn(browser.declarativeNetRequest, "getMatchedRules");

    await expect(matchedRulesForActiveTab()).resolves.toBeUndefined();
    expect(getRules).not.toHaveBeenCalled();
  });

  it("never calls getMatchedRules without a tab id anywhere in the module", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./verify.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/getMatchedRules\(\s*\)/);
  });
});
