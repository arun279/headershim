import { describe, expect, it } from "vitest";
import {
  allocateRuleNum,
  cloneRule,
  createProfile,
  createRule,
  isProfileNameAvailable,
  normalizeBadgeText,
  type Profile,
  type Rule,
  type RuleDraft,
  type StateDoc,
  switchToNextProfile,
} from "./model";

function emptyDoc(nextRuleNum = 1): StateDoc {
  return {
    v: 1,
    profiles: [],
    focusedProfileId: "profile-1",
    nextRuleNum,
    settings: { paused: false, theme: "system", badgeMode: "count" },
  };
}

function profile(id: string, name: string): Profile {
  return {
    id,
    name,
    badgeText: "P",
    color: "blue",
    enabled: true,
    rules: [],
  };
}

const baseDraft: RuleDraft = {
  direction: "request",
  operation: "set",
  header: "x-trace",
  value: "enabled",
  scope: {
    type: "pattern",
    pattern: "||example.com^",
    hosts: ["example.com"],
  },
  resourceTypes: ["xhr", "scripts"],
  initiators: ["app.example.com"],
  enabled: true,
  comment: "staging",
  generated: { kind: "timestamp", at: "2026-07-12T14:03:00Z" },
};

describe("rule allocation", () => {
  it("allocates increasing numbers for create, clone, and import paths", () => {
    const [first, afterFirst] = createRule(emptyDoc(41), baseDraft);
    const [second, afterSecond] = createRule(afterFirst, {
      direction: "response",
      operation: "remove",
      header: "server",
      scope: { type: "domains", domains: ["example.com"] },
      resourceTypes: "all",
      initiators: [],
      enabled: false,
    });
    const [cloned, afterClone] = cloneRule(afterSecond, first);
    const [imported, afterImport] = createRule(afterClone, {
      ...baseDraft,
      scope: {
        type: "regex",
        regex: "^https://api\\.example\\.com/",
        hosts: ["api.example.com"],
      },
    });
    const [allSites, finalDoc] = createRule(afterImport, {
      ...baseDraft,
      scope: { type: "all" },
    });

    expect([
      first.num,
      second.num,
      cloned.num,
      imported.num,
      allSites.num,
    ]).toEqual([41, 42, 43, 44, 45]);
    expect(finalDoc.nextRuleNum).toBe(46);
    expect(
      new Set([first.id, second.id, cloned.id, imported.id, allSites.id]).size,
    ).toBe(5);
    expect(cloned).toEqual({ ...first, id: cloned.id, num: 43 });
    expect(cloned.scope).not.toBe(first.scope);
    expect(cloned.resourceTypes).not.toBe(first.resourceTypes);
    expect(cloned.initiators).not.toBe(first.initiators);
    expect(cloned.generated).not.toBe(first.generated);
    expect(second).not.toHaveProperty("value");
    expect(second).not.toHaveProperty("comment");
    expect(second).not.toHaveProperty("generated");
  });

  it("rejects exhausted or invalid counters", () => {
    expect(() => allocateRuleNum(emptyDoc(0))).toThrow(RangeError);
    expect(() => allocateRuleNum(emptyDoc(1.5))).toThrow(RangeError);
    expect(() => allocateRuleNum(emptyDoc(Number.MAX_SAFE_INTEGER))).toThrow(
      RangeError,
    );
  });
});

describe("profile invariants", () => {
  it("requires a nonblank 1-48 character name unique without case", () => {
    const profiles = [profile("one", "Default"), profile("two", "Staging")];

    expect(isProfileNameAvailable(profiles, "Production")).toBe(true);
    expect(isProfileNameAvailable(profiles, "D")).toBe(true);
    expect(isProfileNameAvailable(profiles, "x".repeat(48))).toBe(true);
    expect(isProfileNameAvailable(profiles, "")).toBe(false);
    expect(isProfileNameAvailable(profiles, "   ")).toBe(false);
    expect(isProfileNameAvailable(profiles, "x".repeat(49))).toBe(false);
    expect(isProfileNameAvailable(profiles, "default")).toBe(false);
    expect(isProfileNameAvailable(profiles, "DEFAULT", "one")).toBe(true);
  });

  it("truncates badge text to two graphemes when constructing a profile", () => {
    const created = createProfile({
      name: "Production",
      badgeText: "👩🏽‍💻AB",
      color: "plum",
      enabled: false,
    });

    expect(normalizeBadgeText("")).toBe("");
    expect(normalizeBadgeText("AB")).toBe("AB");
    expect(normalizeBadgeText("ABC")).toBe("AB");
    expect(normalizeBadgeText("🇺🇸USA")).toBe("🇺🇸U");
    expect(created.badgeText).toBe("👩🏽‍💻A");
    expect(created.rules).toEqual([]);
    expect(created.id).not.toBe("");
  });
});

describe("switchToNextProfile", () => {
  function docWith(profiles: Profile[], focusedProfileId: string): StateDoc {
    return { ...emptyDoc(), profiles, focusedProfileId };
  }

  it("enables exactly the profile after the focused one and focuses it", () => {
    const doc = docWith(
      [
        profile("one", "Default"),
        profile("two", "Staging"),
        profile("three", "QA"),
      ],
      "one",
    );

    const next = switchToNextProfile(doc);

    expect(next.focusedProfileId).toBe("two");
    expect(next.profiles.map(({ enabled }) => enabled)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("wraps from the last profile to the first", () => {
    const doc = docWith(
      [profile("one", "Default"), profile("two", "Staging")],
      "two",
    );

    expect(switchToNextProfile(doc).focusedProfileId).toBe("one");
  });

  it("keeps a single profile enabled and focused", () => {
    const doc = docWith(
      [{ ...profile("one", "Default"), enabled: false }],
      "one",
    );

    const next = switchToNextProfile(doc);

    expect(next.focusedProfileId).toBe("one");
    expect(next.profiles.map(({ enabled }) => enabled)).toEqual([true]);
  });

  it("returns the document unchanged when it has no profiles", () => {
    const doc = emptyDoc();

    expect(switchToNextProfile(doc)).toBe(doc);
  });

  it("skips a profile whose enabled rules exceed the live caps", () => {
    const oversized: Profile = {
      ...profile("two", "Bulk"),
      enabled: false,
      rules: bulkRules(4_501),
    };
    const doc = docWith(
      [profile("one", "Default"), oversized, profile("three", "QA")],
      "one",
    );

    const next = switchToNextProfile(doc);

    expect(next.focusedProfileId).toBe("three");
    expect(next.profiles.map(({ enabled }) => enabled)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("keeps the document unchanged when every candidate exceeds the caps", () => {
    const regexRules = bulkRules(1_001).map((rule) => ({
      ...rule,
      scope: {
        type: "regex" as const,
        regex: "^https://api\\.example\\.com/",
        hosts: ["api.example.com"],
      },
    }));
    const doc = docWith(
      [{ ...profile("one", "Default"), rules: regexRules }],
      "one",
    );

    expect(switchToNextProfile(doc)).toBe(doc);
  });
});

function bulkRules(count: number): Rule[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `rule-${index}`,
    num: index + 1,
    direction: "request" as const,
    operation: "set" as const,
    header: "x-bulk",
    value: "1",
    scope: { type: "domains" as const, domains: ["example.com"] },
    resourceTypes: "all" as const,
    initiators: [],
    enabled: true,
  }));
}
