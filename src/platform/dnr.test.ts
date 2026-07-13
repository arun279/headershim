import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { DnrRule } from "../core/compile";
import {
  getDynamicRules,
  getSessionRules,
  isRegexSupported,
  setExtensionActionOptions,
  updateDynamicRules,
  updateSessionRules,
} from "./dnr";
import { FakeDnr } from "./dnr.fake";

const rule: DnrRule = {
  id: 9,
  priority: 99,
  action: {
    type: "modifyHeaders",
    requestHeaders: [{ header: "x-debug", operation: "set", value: "yes" }],
  },
  condition: { resourceTypes: ["xmlhttprequest"] },
};

describe("DNR adapter", () => {
  it("forwards rule operations and converts regex support results", async () => {
    const api = browser.declarativeNetRequest;
    vi.spyOn(api, "getDynamicRules").mockImplementation(async () => [rule]);
    vi.spyOn(api, "getSessionRules").mockImplementation(async () => [rule]);
    const updateDynamic = vi
      .spyOn(api, "updateDynamicRules")
      .mockResolvedValue();
    const updateSession = vi
      .spyOn(api, "updateSessionRules")
      .mockResolvedValue();
    const regex = vi
      .spyOn(api, "isRegexSupported")
      .mockImplementationOnce(async () => ({ isSupported: true }))
      .mockImplementationOnce(async () => ({
        isSupported: false,
        reason: "syntaxError",
      }));
    const setOptions = vi
      .spyOn(api, "setExtensionActionOptions")
      .mockResolvedValue();

    expect(await getDynamicRules()).toEqual([rule]);
    expect(await getSessionRules()).toEqual([rule]);
    await updateDynamicRules({ addRules: [rule], removeRuleIds: [1] });
    await updateSessionRules({ addRules: [rule], removeRuleIds: [2] });
    expect(updateDynamic).toHaveBeenCalledWith({
      addRules: [rule],
      removeRuleIds: [1],
    });
    expect(updateSession).toHaveBeenCalledWith({
      addRules: [rule],
      removeRuleIds: [2],
    });
    expect(await isRegexSupported("valid")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await isRegexSupported("invalid")).toEqual({
      ok: false,
      error: "syntaxError",
    });
    await setExtensionActionOptions({ displayActionCountAsBadgeText: true });
    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: true,
    });
    expect(regex).toHaveBeenCalledTimes(2);
  });
});

describe("FakeDnr", () => {
  it("keeps dynamic and session rules in memory and records options", async () => {
    const fake = new FakeDnr();

    await fake.updateDynamicRules({ addRules: [rule] });
    await fake.updateSessionRules({ addRules: [rule] });
    expect(await fake.getDynamicRules()).toEqual([rule]);
    expect(await fake.getSessionRules()).toEqual([rule]);

    await fake.updateDynamicRules({ removeRuleIds: [rule.id] });
    await fake.updateSessionRules({ removeRuleIds: [rule.id] });
    expect(await fake.getDynamicRules()).toEqual([]);
    expect(await fake.getSessionRules()).toEqual([]);
    expect(await fake.isRegexSupported("anything")).toEqual({
      ok: true,
      value: undefined,
    });

    await fake.setExtensionActionOptions({
      displayActionCountAsBadgeText: false,
    });
    expect(fake.extensionActionOptions).toEqual([
      { displayActionCountAsBadgeText: false },
    ]);
  });
});
