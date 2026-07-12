import { describe, expect, it } from "vitest";
import {
  DYNAMIC_RULESET_ID,
  decodeMatches,
  type RawRuleMatch,
  SESSION_RULESET_ID,
} from "./matches";
import type { Profile, Rule, StateDoc, TabOverride } from "./model";

function storedRule(num: number, enabled = true): Rule {
  return {
    id: `rule-${num}`,
    num,
    direction: "request",
    operation: "set",
    header: "x-debug",
    value: `${num}`,
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled,
  };
}

function profile(id: string, rules: Rule[]): Profile {
  return {
    id,
    name: id,
    badgeText: id.slice(0, 2),
    color: "blue",
    enabled: true,
    rules,
  };
}

function state(profiles: Profile[]): StateDoc {
  return {
    v: 1,
    profiles,
    focusedProfileId: profiles[0]?.id ?? "",
    nextRuleNum: 1_000,
    settings: { paused: false, theme: "system", badgeMode: "count" },
  };
}

function rawMatch(
  ruleId: number,
  rulesetId: string,
  timeStamp: number,
): RawRuleMatch {
  return { rule: { ruleId, rulesetId }, tabId: 42, timeStamp };
}

describe("matched rule decoding", () => {
  it("attributes retained matches by stable number after insert, reorder, and toggle", () => {
    const first = storedRule(10);
    const second = storedRule(20, false);
    const inserted = storedRule(15);
    const fourMinutesAgo = 1_752_340_560_000;
    const editedState = state([
      profile("second-profile", [second]),
      profile("first-profile", [inserted, first]),
    ]);

    expect(
      decodeMatches(
        editedState,
        [],
        [
          rawMatch(10, DYNAMIC_RULESET_ID, fourMinutesAgo),
          rawMatch(20, DYNAMIC_RULESET_ID, fourMinutesAgo + 1),
        ],
      ),
    ).toEqual([
      {
        kind: "dynamic",
        profileId: "first-profile",
        rule: first,
        tabId: 42,
        timeStamp: fourMinutesAgo,
      },
      {
        kind: "dynamic",
        profileId: "second-profile",
        rule: second,
        tabId: 42,
        timeStamp: fourMinutesAgo + 1,
      },
    ]);
  });

  it("drops retained matches for deleted rules instead of reassigning them", () => {
    const remaining = storedRule(20);
    const fourMinutesAgo = 1_752_340_560_000;

    expect(
      decodeMatches(
        state([profile("current", [remaining])]),
        [],
        [
          rawMatch(10, DYNAMIC_RULESET_ID, fourMinutesAgo),
          rawMatch(20, DYNAMIC_RULESET_ID, fourMinutesAgo + 1),
        ],
      ),
    ).toEqual([
      {
        kind: "dynamic",
        profileId: "current",
        rule: remaining,
        tabId: 42,
        timeStamp: fourMinutesAgo + 1,
      },
    ]);
  });

  it("routes colliding ids by dynamic and session ruleset", () => {
    const dynamic = storedRule(30);
    const override: TabOverride = {
      num: 30,
      tabId: 42,
      originHost: "example.com",
      direction: "request",
      operation: "append",
      header: "x-debug",
      value: "session",
    };

    expect(
      decodeMatches(
        state([profile("dynamic", [dynamic])]),
        [override],
        [
          rawMatch(30, SESSION_RULESET_ID, 100),
          rawMatch(30, DYNAMIC_RULESET_ID, 101),
          rawMatch(30, "static-rules", 102),
          rawMatch(999, SESSION_RULESET_ID, 103),
        ],
      ),
    ).toEqual([
      {
        kind: "session",
        override,
        tabId: 42,
        timeStamp: 100,
      },
      {
        kind: "dynamic",
        profileId: "dynamic",
        rule: dynamic,
        tabId: 42,
        timeStamp: 101,
      },
    ]);
  });
});
