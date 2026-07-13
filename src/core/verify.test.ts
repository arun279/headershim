import { describe, expect, it } from "vitest";
import {
  type DecodedMatch,
  DYNAMIC_RULESET_ID,
  decodeMatches,
  type RawRuleMatch,
  SESSION_RULESET_ID,
} from "./matches";
import type { Rule, TabOverride } from "./model";
import { makeDoc, profile } from "./test-fixtures";
import { summarizeVerify, type VerifyHint } from "./verify";

const ALLOWED_HINTS: readonly VerifyHint[] = [
  "disabled",
  "scope-excludes",
  "needs-access",
];

function rule(num: number, overrides: Partial<Rule> = {}): Rule {
  return {
    id: `rule-${num}`,
    num,
    direction: "request",
    operation: "set",
    header: `x-${num}`,
    value: `${num}`,
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

function dynamicMatch(profileId: string, matched: Rule): DecodedMatch {
  return { kind: "dynamic", profileId, rule: matched, tabId: 7, timeStamp: 0 };
}

describe("summarizeVerify tallies", () => {
  it("splits enabled-profile rules into fired and no-match with the honest fraction", () => {
    const fired = rule(1);
    const quiet = rule(2);
    const readout = summarizeVerify({
      profiles: [profile("p", [fired, quiet])],
      matches: [dynamicMatch("p", fired)],
      tabHost: "example.com",
      needsAccessRuleIds: new Set(),
    });

    expect(readout.matched).toEqual([
      { profileId: "p", rule: fired, count: 1 },
    ]);
    expect(readout.unmatched).toEqual([{ profileId: "p", rule: quiet }]);
    expect(readout.total).toBe(2);
  });

  it("counts repeat matches for the same rule by stable number", () => {
    const fired = rule(1);
    const readout = summarizeVerify({
      profiles: [profile("p", [fired])],
      matches: [
        dynamicMatch("p", fired),
        dynamicMatch("p", fired),
        dynamicMatch("p", fired),
      ],
      tabHost: "example.com",
      needsAccessRuleIds: new Set(),
    });
    expect(readout.matched[0]?.count).toBe(3);
  });

  it("never lets a This-tab session match enter the profile-rule count", () => {
    const target = rule(30);
    const sessionMatch: DecodedMatch = {
      kind: "session",
      override: {
        num: 30,
        tabId: 7,
        originHost: "example.com",
        direction: "request",
        operation: "set",
        header: "x-30",
      },
      tabId: 7,
      timeStamp: 0,
    };
    const readout = summarizeVerify({
      profiles: [profile("p", [target])],
      matches: [sessionMatch],
      tabHost: "example.com",
      needsAccessRuleIds: new Set(),
    });
    // The override shares rule 30's number; it must not tally the profile rule.
    expect(readout.matched).toEqual([]);
    expect(readout.unmatched).toEqual([{ profileId: "p", rule: target }]);
  });
});

describe("summarizeVerify hints stay statically determinable", () => {
  it("names only disabled, scope-excludes, and needs-access, never anything else", () => {
    const disabled = rule(1, { enabled: false });
    const offSite = rule(2, {
      scope: { type: "domains", domains: ["other.test"] },
    });
    const ungranted = rule(3);
    const cachedOrTypeMismatch = rule(4); // enabled, on-site, granted, no match
    const readout = summarizeVerify({
      profiles: [
        profile("p", [disabled, offSite, ungranted, cachedOrTypeMismatch]),
      ],
      matches: [],
      tabHost: "example.com",
      needsAccessRuleIds: new Set(["rule-3"]),
    });

    const hints = new Map(
      readout.unmatched.map((row) => [row.rule.id, row.hint]),
    );
    expect(hints.get("rule-1")).toBe("disabled");
    expect(hints.get("rule-2")).toBe("scope-excludes");
    expect(hints.get("rule-3")).toBe("needs-access");
    // The one whose only possible causes are traffic-derived (a cached
    // response, a resource-type mismatch, an unnamed initiator) gets no
    // per-rule verdict — those live only in the hedged general guidance.
    expect(hints.get("rule-4")).toBeUndefined();

    for (const row of readout.unmatched) {
      if (row.hint !== undefined) {
        expect(ALLOWED_HINTS).toContain(row.hint);
      }
    }
  });

  it("derives hints from static inputs alone — unrelated matches never change them", () => {
    const quiet = rule(1);
    const noisyNeighbour = rule(2);
    const base = {
      profiles: [profile("p", [quiet, noisyNeighbour])],
      tabHost: "example.com" as string | undefined,
      needsAccessRuleIds: new Set<string>(),
    };

    const withoutTraffic = summarizeVerify({ ...base, matches: [] });
    const withNeighbourTraffic = summarizeVerify({
      ...base,
      matches: [
        dynamicMatch("p", noisyNeighbour),
        dynamicMatch("p", noisyNeighbour),
      ],
    });

    const hintFor = (readout: ReturnType<typeof summarizeVerify>) =>
      readout.unmatched.find((row) => row.rule.id === "rule-1")?.hint;
    // Rule 1 never matched in either run; its hint depends only on the rule,
    // the site, and the grant set — not on what other rules did.
    expect(hintFor(withoutTraffic)).toBeUndefined();
    expect(hintFor(withNeighbourTraffic)).toBeUndefined();
  });

  it("will not claim scope-excludes for a pattern or regex scope it cannot prove", () => {
    const patternRule = rule(1, {
      scope: { type: "pattern", pattern: "||other.test^", hosts: [] },
    });
    const regexRule = rule(2, {
      scope: { type: "regex", regex: ".*", hosts: [] },
    });
    const readout = summarizeVerify({
      profiles: [profile("p", [patternRule, regexRule])],
      matches: [],
      tabHost: "example.com",
      needsAccessRuleIds: new Set(),
    });
    expect(readout.unmatched.map((row) => row.hint)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("cannot prove scope-excludes without a known web host", () => {
    const offSite = rule(1, {
      scope: { type: "domains", domains: ["other.test"] },
    });
    const readout = summarizeVerify({
      profiles: [profile("p", [offSite])],
      matches: [],
      tabHost: undefined,
      needsAccessRuleIds: new Set(),
    });
    expect(readout.unmatched[0]?.hint).toBeUndefined();
  });

  it("covers the tab's own site through parent domains without a scope hint", () => {
    const parentScoped = rule(1, {
      scope: { type: "domains", domains: ["example.com"] },
    });
    const readout = summarizeVerify({
      profiles: [profile("p", [parentScoped])],
      matches: [],
      tabHost: "api.example.com",
      needsAccessRuleIds: new Set(),
    });
    expect(readout.unmatched[0]?.hint).toBeUndefined();
  });

  it("prefers disabled over an overlapping scope or grant cause", () => {
    const disabledOffSite = rule(1, {
      enabled: false,
      scope: { type: "domains", domains: ["other.test"] },
    });
    const readout = summarizeVerify({
      profiles: [profile("p", [disabledOffSite])],
      matches: [],
      tabHost: "example.com",
      needsAccessRuleIds: new Set(["rule-1"]),
    });
    expect(readout.unmatched[0]?.hint).toBe("disabled");
  });

  it("prefers scope-excludes over needs-access when the site is off-scope", () => {
    const offSiteUngranted = rule(1, {
      scope: { type: "domains", domains: ["other.test"] },
    });
    const readout = summarizeVerify({
      profiles: [profile("p", [offSiteUngranted])],
      matches: [],
      tabHost: "example.com",
      needsAccessRuleIds: new Set(["rule-1"]),
    });
    expect(readout.unmatched[0]?.hint).toBe("scope-excludes");
  });

  it("never hints a rule that fired, even when it lacks a grant", () => {
    const fired = rule(1);
    const readout = summarizeVerify({
      profiles: [profile("p", [fired])],
      matches: [dynamicMatch("p", fired)],
      tabHost: "example.com",
      needsAccessRuleIds: new Set(["rule-1"]),
    });
    expect(readout.matched).toEqual([
      { profileId: "p", rule: fired, count: 1 },
    ]);
    expect(readout.unmatched).toEqual([]);
  });
});

describe("summarizeVerify over decodeMatches output", () => {
  const raw = (ruleId: number): RawRuleMatch => ({
    rule: { ruleId, rulesetId: DYNAMIC_RULESET_ID },
    tabId: 7,
    timeStamp: 1_752_340_560_000,
  });

  it("tallies retained rules and drops a deleted rule's matches", () => {
    const retained = rule(20);
    const state = makeDoc([profile("p", [retained])]);
    const overrides: TabOverride[] = [];
    const decoded = decodeMatches(state, overrides, [
      raw(10),
      raw(20),
      raw(20),
    ]);

    const readout = summarizeVerify({
      profiles: state.profiles,
      matches: decoded,
      tabHost: "example.com",
      needsAccessRuleIds: new Set(),
    });
    // Rule 10 was deleted: its matches decode to nothing and never resurface.
    expect(readout.matched).toEqual([
      { profileId: "p", rule: retained, count: 2 },
    ]);
    expect(readout.total).toBe(1);
  });

  it("keeps a session-ruleset match out of the profile tally", () => {
    const dynamicRule = rule(30);
    const override: TabOverride = {
      num: 30,
      tabId: 7,
      originHost: "example.com",
      direction: "request",
      operation: "append",
      header: "x-30",
      value: "session",
    };
    const state = makeDoc([profile("p", [dynamicRule])]);
    const decoded = decodeMatches(
      state,
      [override],
      [
        {
          rule: { ruleId: 30, rulesetId: SESSION_RULESET_ID },
          tabId: 7,
          timeStamp: 1,
        },
      ],
    );
    const readout = summarizeVerify({
      profiles: state.profiles,
      matches: decoded,
      tabHost: "example.com",
      needsAccessRuleIds: new Set(),
    });
    expect(readout.matched).toEqual([]);
    expect(readout.unmatched).toEqual([{ profileId: "p", rule: dynamicRule }]);
  });
});
