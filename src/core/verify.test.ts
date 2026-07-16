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
import { summarizeVerify } from "./verify";

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
  it("returns only enabled-profile rules that fired", () => {
    const fired = rule(1);
    const quiet = rule(2);
    const readout = summarizeVerify({
      profiles: [profile("p", [fired, quiet])],
      matches: [dynamicMatch("p", fired)],
    });

    expect(readout.matched).toEqual([
      { profileId: "p", rule: fired, count: 1 },
    ]);
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
        enabled: true,
      },
      tabId: 7,
      timeStamp: 0,
    };
    const readout = summarizeVerify({
      profiles: [profile("p", [target])],
      matches: [sessionMatch],
    });
    // The override shares rule 30's number; it must not tally the profile rule.
    expect(readout.matched).toEqual([]);
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
    });
    // Rule 10 was deleted: its matches decode to nothing and never resurface.
    expect(readout.matched).toEqual([
      { profileId: "p", rule: retained, count: 2 },
    ]);
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
      enabled: true,
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
    });
    expect(readout.matched).toEqual([]);
  });
});
