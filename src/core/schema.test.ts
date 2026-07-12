import { describe, expect, it } from "vitest";
import type { Profile, Rule, Scope, StateDoc } from "./model";
import { CURRENT, createV1Seed, migrate, migrations } from "./schema";

function storedRule(
  num: number,
  scope: Scope,
  overrides: Partial<Rule> = {},
): Rule {
  return {
    id: `rule-${num}`,
    num,
    direction: "request",
    operation: "set",
    header: "x-debug",
    value: "on",
    scope,
    resourceTypes: ["pages", "xhr"],
    initiators: ["app.example.com"],
    enabled: true,
    comment: "development",
    generated: { kind: "uuid", at: "2026-07-12T14:03:00Z" },
    ...overrides,
  };
}

function validDoc(): StateDoc {
  const profiles: Profile[] = [
    {
      id: "profile-default",
      name: "Default",
      badgeText: "DE",
      color: "indigo",
      enabled: true,
      rules: [
        storedRule(1, { type: "domains", domains: ["example.com"] }),
        storedRule(
          2,
          {
            type: "pattern",
            pattern: "||example.com^",
            hosts: ["example.com"],
          },
          {
            direction: "response",
            operation: "append",
            header: "cache-control",
            generated: {
              kind: "timestamp",
              at: "2026-07-12T14:04:00Z",
            },
          },
        ),
        storedRule(3, {
          type: "regex",
          regex: "^https://api\\.example\\.com/",
          hosts: [],
        }),
        {
          id: "rule-4",
          num: 4,
          direction: "response",
          operation: "remove",
          header: "server",
          scope: { type: "all" },
          resourceTypes: "all",
          initiators: [],
          enabled: false,
        },
      ],
    },
    {
      id: "profile-staging",
      name: "Staging",
      badgeText: "S",
      color: "slate",
      enabled: false,
      rules: [],
    },
  ];

  return {
    v: 1,
    profiles,
    focusedProfileId: profiles[0]?.id ?? "",
    nextRuleNum: 5,
    settings: { paused: false, theme: "system", badgeMode: "count" },
  };
}

function firstProfile(doc = validDoc()): Profile {
  const profile = doc.profiles[0];
  if (profile === undefined) {
    throw new Error("fixture must contain a profile");
  }
  return profile;
}

function firstRule(doc = validDoc()): Rule {
  const rule = firstProfile(doc).rules[0];
  if (rule === undefined) {
    throw new Error("fixture must contain a rule");
  }
  return rule;
}

function withProfile(patch: Record<string, unknown>): unknown {
  const doc = validDoc();
  const [profile, ...remaining] = doc.profiles;
  if (profile === undefined) {
    throw new Error("fixture must contain a profile");
  }
  return { ...doc, profiles: [{ ...profile, ...patch }, ...remaining] };
}

function withRule(patch: Record<string, unknown>): unknown {
  const doc = validDoc();
  const profile = firstProfile(doc);
  const rule = firstRule(doc);
  return {
    ...doc,
    profiles: [{ ...profile, rules: [{ ...rule, ...patch }] }],
  };
}

function withSettings(patch: Record<string, unknown>): unknown {
  const doc = validDoc();
  return { ...doc, settings: { ...doc.settings, ...patch } };
}

describe("migrate", () => {
  it("passes a valid current-version document through unchanged", () => {
    const doc = validDoc();
    const result = migrate(doc);

    expect(result).toEqual({ ok: true, value: doc });
    if (result.ok) {
      expect(result.value).toBe(doc);
      expect(result.value.profiles[0]?.rules[1]?.scope).toEqual({
        type: "pattern",
        pattern: "||example.com^",
        hosts: ["example.com"],
      });
      expect(result.value.profiles[0]?.rules[2]?.scope).toEqual({
        type: "regex",
        regex: "^https://api\\.example\\.com/",
        hosts: [],
      });
    }
    expect(migrations).toEqual({});
  });

  it("accepts all current settings variants", () => {
    const light = validDoc();
    light.settings = { paused: true, theme: "light", badgeMode: "initials" };
    const dark = validDoc();
    dark.settings = { paused: false, theme: "dark", badgeMode: "count" };

    expect(migrate(light).ok).toBe(true);
    expect(migrate(dark).ok).toBe(true);
  });

  it("returns a corrupt error for unknown and malformed documents", () => {
    const duplicateProfile = firstProfile();
    const duplicateRule = firstRule();
    const malformed: readonly unknown[] = [
      undefined,
      null,
      [],
      {},
      { v: "1" },
      { v: 0 },
      { v: 1.5 },
      { v: 1 },
      { ...validDoc(), profiles: [] },
      { ...validDoc(), profiles: "Default" },
      { ...validDoc(), profiles: [null] },
      { ...validDoc(), focusedProfileId: undefined },
      { ...validDoc(), focusedProfileId: "missing" },
      { ...validDoc(), nextRuleNum: "5" },
      { ...validDoc(), nextRuleNum: 0 },
      { ...validDoc(), nextRuleNum: 1.5 },
      { ...validDoc(), settings: null },
      withSettings({ paused: "false" }),
      withSettings({ theme: "contrast" }),
      withSettings({ badgeMode: "profile" }),
      withProfile({ id: null }),
      withProfile({ id: "" }),
      withProfile({ name: null }),
      withProfile({ name: " " }),
      withProfile({ name: "x".repeat(49) }),
      withProfile({ badgeText: null }),
      withProfile({ badgeText: "ABC" }),
      withProfile({ color: "amber" }),
      withProfile({ enabled: "true" }),
      withProfile({ rules: null }),
      withProfile({ rules: [null] }),
      {
        ...validDoc(),
        profiles: [
          duplicateProfile,
          { ...duplicateProfile, name: "Another profile" },
        ],
      },
      {
        ...validDoc(),
        profiles: [
          duplicateProfile,
          { ...duplicateProfile, id: "another-id", name: "DEFAULT" },
        ],
      },
      withRule({ id: null }),
      withRule({ id: "" }),
      withRule({ num: "1" }),
      withRule({ num: 1.5 }),
      withRule({ num: 0 }),
      withRule({ direction: "both" }),
      withRule({ operation: "replace" }),
      withRule({ header: null }),
      withRule({ header: "" }),
      withRule({ header: "X-Debug" }),
      withRule({ header: " x-debug" }),
      withRule({ value: undefined }),
      withRule({ operation: "remove" }),
      withRule({ scope: null }),
      withRule({ scope: { type: "domains", domains: [] } }),
      withRule({ scope: { type: "domains", domains: [""] } }),
      withRule({ scope: { type: "pattern", pattern: "", hosts: [] } }),
      withRule({
        scope: { type: "pattern", pattern: "||example.com^", hosts: [""] },
      }),
      withRule({ scope: { type: "regex", regex: "", hosts: [] } }),
      withRule({
        scope: { type: "regex", regex: "example", hosts: "example.com" },
      }),
      withRule({ scope: { type: "unsupported" } }),
      withRule({ resourceTypes: [] }),
      withRule({ resourceTypes: ["pages", "pages"] }),
      withRule({ resourceTypes: ["main_frame"] }),
      withRule({ initiators: "app.example.com" }),
      withRule({ initiators: [""] }),
      withRule({ enabled: 1 }),
      withRule({ comment: 1 }),
      withRule({ generated: null }),
      withRule({ generated: { kind: "random", at: "now" } }),
      withRule({ generated: { kind: "uuid", at: 1 } }),
      {
        ...validDoc(),
        profiles: [
          {
            ...firstProfile(),
            rules: [duplicateRule, { ...duplicateRule, num: 2 }],
          },
        ],
      },
      {
        ...validDoc(),
        profiles: [
          {
            ...firstProfile(),
            rules: [duplicateRule, { ...duplicateRule, id: "another-rule" }],
          },
        ],
      },
      { ...validDoc(), nextRuleNum: 4 },
    ];

    for (const doc of malformed) {
      expect(() => migrate(doc)).not.toThrow();
      expect(migrate(doc)).toEqual({ ok: false, error: { kind: "corrupt" } });
    }
  });

  it("returns a newer-store error without inspecting or throwing on its shape", () => {
    const doc = { v: CURRENT + 1, profiles: null };

    expect(() => migrate(doc)).not.toThrow();
    expect(migrate(doc)).toEqual({
      ok: false,
      error: { kind: "newer-store", foundVersion: 2 },
    });
  });
});

describe("createV1Seed", () => {
  it("creates one enabled and focused empty Default profile", () => {
    const seed = createV1Seed();

    expect(seed).toMatchObject({
      v: 1,
      nextRuleNum: 1,
      settings: { paused: false, theme: "system", badgeMode: "count" },
      profiles: [
        {
          name: "Default",
          badgeText: "DE",
          color: "indigo",
          enabled: true,
          rules: [],
        },
      ],
    });
    expect(seed.focusedProfileId).toBe(seed.profiles[0]?.id);
    expect(migrate(seed)).toEqual({ ok: true, value: seed });
    expect(createV1Seed()).not.toBe(seed);
  });
});
