import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { DnrRule } from "../core/compile";
import { MAX_DYNAMIC_RULES, MAX_REGEX_RULES } from "../core/limits";
import type { Rule, StateDoc } from "../core/model";
import {
  DNR_CONTRACT_CASES,
  DNR_REGEX_CONTRACT_CASES,
  exerciseDnrContract,
} from "../test/dnr-contract";
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
  const browserOnlyCases = DNR_CONTRACT_CASES.filter(
    ({ browserOnly }) => browserOnly,
  );

  it("limits browser-only contract cases to regular expression behavior", () => {
    expect(browserOnlyCases).toHaveLength(7);
    expect(
      browserOnlyCases.every(
        (contractCase) => contractCase.rule.condition.regexFilter !== undefined,
      ),
    ).toBe(true);
  });

  it.each(DNR_CONTRACT_CASES.filter(({ browserOnly }) => !browserOnly))(
    "$name",
    async (contractCase) => {
      await exerciseDnrContract(new FakeDnr(), contractCase);
    },
  );

  it("does not model browser regular expression support", async () => {
    const fake = new FakeDnr();
    expect(await fake.isRegexSupported("[")).toEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      fake.updateDynamicRules({
        addRules: [
          {
            ...rule,
            condition: { ...rule.condition, regexFilter: "[" },
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it.each(DNR_REGEX_CONTRACT_CASES.filter(({ supported }) => supported))(
    "$name",
    async (contractCase) => {
      const result = await new FakeDnr().isRegexSupported(contractCase.regex);
      expect(result.ok).toBe(true);
    },
  );

  it("rejects invalid updates atomically", async () => {
    const fake = new FakeDnr();
    const invalid: DnrRule = {
      ...rule,
      id: rule.id + 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "invalid header", operation: "set", value: "yes" },
        ],
      },
    };

    await fake.updateDynamicRules({ addRules: [rule] });
    await expect(
      fake.updateDynamicRules({
        addRules: [invalid],
        removeRuleIds: [rule.id],
      }),
    ).rejects.toThrow("Invalid DNR rule");
    expect(await fake.getDynamicRules()).toEqual([rule]);
  });

  it("rejects dynamic and session rule-count overflow", async () => {
    const fake = new FakeDnr();
    const rules = Array.from({ length: MAX_DYNAMIC_RULES + 1 }, (_, index) => ({
      ...rule,
      id: index + 1,
    }));
    await expect(fake.updateDynamicRules({ addRules: rules })).rejects.toThrow(
      "Invalid DNR rule",
    );
    await expect(
      fake.updateSessionRules({
        addRules: rules,
      }),
    ).rejects.toThrow("Invalid DNR rule");
  });

  it("rejects regular expression rule-count overflow", async () => {
    const fake = new FakeDnr();
    const rules = Array.from({ length: MAX_REGEX_RULES + 1 }, (_, index) => ({
      ...rule,
      id: index + 1,
      condition: { regexFilter: `regex-${index}` },
    }));
    await expect(fake.updateDynamicRules({ addRules: rules })).rejects.toThrow(
      "Invalid DNR rule",
    );
  });

  it("keeps dynamic and session rules in memory", async () => {
    const fake = new FakeDnr();
    const sessionRule = {
      ...rule,
      condition: { ...rule.condition, tabIds: [1] },
    };

    await fake.updateDynamicRules({ addRules: [rule] });
    await fake.updateSessionRules({ addRules: [sessionRule] });
    expect(await fake.getDynamicRules()).toEqual([rule]);
    expect(await fake.getSessionRules()).toEqual([sessionRule]);

    await fake.updateDynamicRules({ removeRuleIds: [rule.id] });
    await fake.updateSessionRules({ removeRuleIds: [rule.id] });
    expect(await fake.getDynamicRules()).toEqual([]);
    expect(await fake.getSessionRules()).toEqual([]);
  });
});
