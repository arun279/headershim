import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { DnrRule } from "../core/compile";
import type { Rule, StateDoc } from "../core/model";
import {
  getDynamicRules,
  getSessionRules,
  isRegexSupported,
  resolveRegexSupport,
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

function regexDoc(active: boolean): StateDoc {
  const regexRule: Rule = {
    id: "regex",
    num: 1,
    direction: "request",
    operation: "set",
    header: "x-regex",
    value: "on",
    scope: {
      type: "regex",
      regex: "^https://example\\.com/",
      hosts: ["example.com"],
    },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
  };
  return {
    v: 1,
    profiles: [
      {
        id: "active",
        name: "Active",
        badgeText: "AC",
        color: "blue",
        rules: active ? [regexRule] : [],
      },
      {
        id: "inactive",
        name: "Inactive",
        badgeText: "IN",
        color: "slate",
        rules: active ? [] : [regexRule],
      },
    ],
    activeProfileId: "active",
    nextRuleNum: 2,
    settings: { paused: false, theme: "system" },
  };
}

function acceptRegexes() {
  return vi
    .spyOn(browser.declarativeNetRequest, "isRegexSupported")
    .mockImplementation(async () => ({ isSupported: true }));
}

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
    expect(regex).toHaveBeenCalledTimes(2);
  });

  it("resolves regex support for inactive profiles", async () => {
    const regex = acceptRegexes();
    const supported = await resolveRegexSupport(regexDoc(false));

    expect(supported("^https://example\\.com/")).toBe(true);
    expect(regex).toHaveBeenCalledWith({
      regex: "^https://example\\.com/",
    });
  });

  it("limits background support checks to the active profile", async () => {
    const regex = acceptRegexes();
    const supported = await resolveRegexSupport(regexDoc(false), "active");

    expect(supported("^https://example\\.com/")).toBe(false);
    expect(regex).not.toHaveBeenCalled();
  });

  it("treats a failed support check as unsupported", async () => {
    vi.spyOn(
      browser.declarativeNetRequest,
      "isRegexSupported",
    ).mockRejectedValue(new Error("unavailable"));
    const supported = await resolveRegexSupport(regexDoc(true));

    expect(supported("^https://example\\.com/")).toBe(false);
  });
});

describe("FakeDnr", () => {
  it("keeps dynamic and session rules in memory", async () => {
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
  });
});
