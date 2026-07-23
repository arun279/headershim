import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Profile, Rule, Scope, StateDoc } from "../model";
import {
  applyImportPlan,
  CURRENT_SCHEMA_VERSION,
  createHeadershimEnvelope,
  exportHeadershim,
  importHeadershim,
  migrate,
  migrations,
} from "./headershim";

const GOLDEN_URL = new URL(
  "./__fixtures__/headershim-envelope-v1.golden",
  import.meta.url,
);
const MIGRATION_URL = new URL(
  "./__fixtures__/headershim-envelope-v1.migration",
  import.meta.url,
);

function storedRule(
  id: string,
  num: number,
  scope: Scope,
  overrides: Partial<Rule> = {},
): Rule {
  const stored: Rule = {
    id,
    num,
    scope,
    initiators: ["app.example.com"],
    direction: "request",
    header: "x-debug",
    value: "on",
    operation: "set",
    resourceTypes: ["pages", "xhr"],
    comment: "development",
    enabled: true,
    generated: { kind: "uuid", at: "2026-07-12T14:03:00.000Z" },
  };
  return { ...stored, ...overrides };
}

function profileSet(): StateDoc {
  const profiles: Profile[] = [
    {
      id: "profile-default",
      name: "Default",
      badgeText: "DE",
      color: "indigo",
      rules: [
        storedRule(
          "rule-domains",
          1,
          { type: "domains", domains: ["api.example.com"] },
          { header: "authorization", value: "Bearer secret" },
        ),
        {
          id: "rule-pattern",
          num: 2,
          direction: "response",
          operation: "remove",
          header: "server",
          scope: {
            type: "pattern",
            pattern: "||assets.example.com^",
            hosts: ["assets.example.com"],
          },
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
      rules: [
        storedRule(
          "rule-regex",
          3,
          {
            type: "regex",
            regex: "^https://staging\\.example\\.com/",
            hosts: ["staging.example.com"],
          },
          {
            direction: "response",
            operation: "append",
            header: "cache-control",
            value: "no-store",
            resourceTypes: ["stylesheets", "images"],
            initiators: [],
            comment: "avoid stale assets",
            generated: { kind: "timestamp", at: "2026-07-12T14:04:00.000Z" },
          },
        ),
        {
          id: "rule-all",
          num: 4,
          direction: "request",
          operation: "set",
          header: "x-everywhere",
          value: "on",
          scope: { type: "all" },
          resourceTypes: ["other"],
          initiators: [],
          enabled: true,
        },
      ],
    },
  ];

  return {
    v: 1,
    profiles,
    activeProfileId: profiles[0]?.id,
    nextRuleNum: 5,
    settings: { paused: true, theme: "dark" },
  };
}

function targetDoc(): StateDoc {
  return {
    v: 1,
    profiles: [
      {
        id: "profile-existing",
        name: "Existing",
        badgeText: "EX",
        color: "blue",
        rules: [],
      },
    ],
    activeProfileId: "profile-existing",
    nextRuleNum: 50,
    settings: { paused: false, theme: "light" },
  };
}

function importExported(doc = profileSet(), target = targetDoc()) {
  const result = importHeadershim(
    JSON.parse(exportHeadershim(doc, new Date("2026-07-12T19:03:00.000Z"))),
    target.profiles,
  );
  if (!result.ok) {
    throw new Error(`fixture import failed: ${result.error.kind}`);
  }
  return { plan: result.value, applied: applyImportPlan(target, result.value) };
}

function withoutStorageIdentity(profile: Profile): unknown {
  return {
    name: profile.name,
    badgeText: profile.badgeText,
    color: profile.color,
    rules: profile.rules.map(({ id: _id, num: _num, ...rule }) => rule),
  };
}

function normalizedTimestamp(json: string): string {
  const matches = [...json.matchAll(/^ {2}"exportedAt": "([^"]+)",$/gm)];
  expect(matches).toHaveLength(1);
  const timestamp = matches[0]?.[1];
  expect(timestamp).toBeDefined();
  expect(new Date(timestamp ?? "invalid").toISOString()).toBe(timestamp);
  return json.replace(
    /^ {2}"exportedAt": "[^"]+",$/m,
    '  "exportedAt": "<exportedAt>",',
  );
}

describe("headershim export", () => {
  it("matches the byte-stable golden file apart from one valid timestamp", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-12T19:03:00.000Z"));
      const first = exportHeadershim(profileSet());
      vi.setSystemTime(new Date("2026-07-12T19:04:00.000Z"));
      const second = exportHeadershim(profileSet());
      const golden = readFileSync(GOLDEN_URL, "utf8");

      expect(normalizedTimestamp(first)).toBe(golden);
      expect(normalizedTimestamp(second)).toBe(golden);
      expect(first).not.toBe(second);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exports one profile in the same envelope without storage identifiers", () => {
    const doc = profileSet();
    const selected = doc.profiles[0];
    if (selected === undefined) {
      throw new Error("fixture must contain a profile");
    }

    const envelope = createHeadershimEnvelope(
      selected,
      new Date("2026-07-12T19:03:00.000Z"),
    );
    const serialized = JSON.stringify(envelope);

    expect(envelope.profiles).toHaveLength(1);
    expect(envelope.profiles[0]?.name).toBe("Default");
    expect(serialized).not.toMatch(/"(?:id|num)":/);
    expect(envelope.profiles[0]?.rules[1]?.scope).toEqual({
      type: "pattern",
      pattern: "||assets.example.com^",
      hosts: ["assets.example.com"],
      resourceTypes: "all",
    });
  });
});

describe("headershim import", () => {
  it("round-trips every profile field other than the documented transforms", () => {
    const original = profileSet();
    const { applied } = importExported(original);
    const imported = applied.profiles.slice(1).map(withoutStorageIdentity);
    const expected = original.profiles.map(withoutStorageIdentity);

    expect(imported).toEqual(expected);
  });

  it("regenerates profile ids and allocates fresh rule ids and numbers", () => {
    const original = profileSet();
    const { applied } = importExported(original);
    const imported = applied.profiles.slice(1);

    expect(imported.map(({ id }) => id)).not.toEqual(
      original.profiles.map(({ id }) => id),
    );
    expect(
      imported.flatMap(({ rules }) => rules.map(({ id }) => id)),
    ).not.toEqual(
      original.profiles.flatMap(({ rules }) => rules.map(({ id }) => id)),
    );
    expect(
      imported.flatMap(({ rules }) => rules.map(({ num }) => num)),
    ).toEqual([50, 51, 52, 53]);
    expect(applied.nextRuleNum).toBe(54);
  });

  it("leaves imported profiles inactive while preserving every rule enabled flag", () => {
    const original = profileSet();
    const { plan, applied } = importExported(original);

    expect(plan.profiles.every((profile) => !("enabled" in profile))).toBe(
      true,
    );
    expect(applied.activeProfileId).toBe("profile-existing");
    expect(
      applied.profiles.slice(1).every((profile) => !("enabled" in profile)),
    ).toBe(true);
    expect(
      applied.profiles
        .slice(1)
        .map(({ rules }) => rules.map(({ enabled }) => enabled)),
    ).toEqual(
      original.profiles.map(({ rules }) => rules.map(({ enabled }) => enabled)),
    );
  });

  it("keeps the source document and plan immutable while retaining target settings", () => {
    const target = targetDoc();
    const snapshot = structuredClone(target);
    const result = importHeadershim(
      JSON.parse(exportHeadershim(profileSet())),
      target.profiles,
    );
    if (!result.ok) {
      throw new Error(`fixture import failed: ${result.error.kind}`);
    }
    const planSnapshot = structuredClone(result.value);
    const applied = applyImportPlan(target, result.value);

    expect(target).toEqual(snapshot);
    expect(result.value).toEqual(planSnapshot);
    expect(applied.activeProfileId).toBe(target.activeProfileId);
    expect(applied.settings).toBe(target.settings);
  });

  it("resolves collisions without case and reserves names within the plan", () => {
    const doc = profileSet();
    const duplicate = doc.profiles[0];
    if (duplicate === undefined) {
      throw new Error("fixture must contain a profile");
    }
    doc.profiles = [
      duplicate,
      { ...duplicate, id: "duplicate", name: "default" },
    ];
    const existingProfile = targetDoc().profiles[0];
    if (existingProfile === undefined) {
      throw new Error("fixture must contain a profile");
    }
    const existing = [
      { ...existingProfile, name: "DEFAULT" },
      { ...existingProfile, id: "profile-two", name: "Default 2" },
    ];
    const result = importHeadershim(
      JSON.parse(exportHeadershim(doc)),
      existing,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        profiles: [{ name: "Default 3" }, { name: "default 4" }],
      },
    });
  });

  it("keeps suffixed collision names within the profile name limit", () => {
    const name = "x".repeat(48);
    const doc = profileSet();
    const selected = doc.profiles[0];
    if (selected === undefined) {
      throw new Error("fixture must contain a profile");
    }
    selected.name = name;
    const existingProfile = targetDoc().profiles[0];
    if (existingProfile === undefined) {
      throw new Error("fixture must contain a profile");
    }
    const existing = [{ ...existingProfile, name }];
    const result = importHeadershim(
      JSON.parse(exportHeadershim(selected)),
      existing,
    );

    expect(result).toMatchObject({
      ok: true,
      value: { profiles: [{ name: `${"x".repeat(46)} 2` }] },
    });
  });

  it("itemizes every sensitive rule so no imported file reviews as clean", () => {
    const doc = profileSet();
    const profile = doc.profiles[0];
    if (profile === undefined) {
      throw new Error("fixture must contain a profile");
    }
    profile.rules = [
      ...profile.rules,
      {
        id: "rule-csp",
        num: 9,
        direction: "response",
        operation: "remove",
        header: "content-security-policy",
        scope: { type: "all" },
        resourceTypes: "all",
        initiators: [],
        comment: "unframe the docs",
        enabled: true,
      },
    ];

    expect(
      importHeadershim(JSON.parse(exportHeadershim(doc)), []),
    ).toMatchObject({
      ok: true,
      value: {
        warnings: [
          {
            kind: "credential",
            ruleName: "authorization",
            header: "authorization",
          },
          {
            kind: "security-response",
            ruleName: "content-security-policy",
            header: "content-security-policy",
          },
        ],
      },
    });
  });

  it("returns typed failures for newer and unknown input", () => {
    expect(
      importHeadershim({ app: "headershim", schemaVersion: 2 }, []),
    ).toEqual({
      ok: false,
      error: {
        kind: "newer-version",
        foundVersion: 2,
        supportedVersion: 1,
      },
    });
    expect(importHeadershim({ profiles: [] }, [])).toEqual({
      ok: false,
      error: { kind: "unrecognized-format" },
    });
  });

  it("accepts hand-edited envelopes with second-precision timestamps", () => {
    const envelope = {
      ...createHeadershimEnvelope(profileSet()),
      exportedAt: "2026-07-12T14:03:00Z",
    };

    expect(importHeadershim(envelope, [])).toMatchObject({ ok: true });
  });

  it("rejects malformed recognized envelopes without throwing", () => {
    const valid = createHeadershimEnvelope(
      profileSet(),
      new Date("2026-07-12T19:03:00.000Z"),
    );
    const profile = valid.profiles[0];
    const rule = profile?.rules[0];
    if (profile === undefined || rule === undefined) {
      throw new Error("fixture must contain a rule");
    }

    const malformed: unknown[] = [
      { ...valid, schemaVersion: "1" },
      { ...valid, schemaVersion: 0 },
      { ...valid, schemaVersion: 1.5 },
      { ...valid, exportedAt: "today" },
      { ...valid, exportedAt: 1_752_340_560_000 },
      { ...valid, profiles: null },
      { ...valid, profiles: [null] },
      { ...valid, profiles: [{ ...profile, name: "" }] },
      { ...valid, profiles: [{ ...profile, name: "x".repeat(49) }] },
      { ...valid, profiles: [{ ...profile, badge: "ABC" }] },
      { ...valid, profiles: [{ ...profile, color: "amber" }] },
      { ...valid, profiles: [{ ...profile, rules: null }] },
      { ...valid, profiles: [{ ...profile, rules: [null] }] },
      withRule(valid, { direction: "both" }),
      withRule(valid, { operation: "replace" }),
      withRule(valid, { header: "" }),
      withRule(valid, { header: "X-Debug" }),
      withRule(valid, { value: undefined }),
      withRule(valid, { comment: 1 }),
      withRule(valid, { enabled: "true" }),
      withRule(valid, { initiators: [""] }),
      withRule(valid, { generated: { kind: "random", at: "now" } }),
      withRule(valid, { scope: null }),
      withScope(valid, { resourceTypes: [] }),
      withScope(valid, { resourceTypes: ["pages", "pages"] }),
      withScope(valid, { resourceTypes: ["main_frame"] }),
      withScope(valid, { type: "domains", domains: [] }),
      withScope(valid, { type: "pattern", pattern: "", hosts: [] }),
      withScope(valid, { type: "pattern", pattern: "x", hosts: [""] }),
      withScope(valid, { type: "regex", regex: "", hosts: [] }),
      withScope(valid, { type: "unknown" }),
    ];

    for (const envelope of malformed) {
      expect(() => importHeadershim(envelope, [])).not.toThrow();
      expect(importHeadershim(envelope, [])).toEqual({
        ok: false,
        error: { kind: "invalid-export" },
      });
    }
  });
});

describe("envelope migrations", () => {
  it("passes the current golden envelope through the independent chain", () => {
    const raw = readFileSync(MIGRATION_URL, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const result = migrate(parsed);

    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(migrations).toEqual({});
    expect(result).toEqual({ ok: true, value: parsed });
    if (result.ok) {
      expect(result.value).toBe(parsed);
      expect(`${JSON.stringify(result.value, null, 2)}\n`).toBe(raw);
    }
    expect(MIGRATION_URL.pathname).toContain(
      "/codec/__fixtures__/headershim-envelope-v1.migration",
    );
    expect(MIGRATION_URL.pathname).not.toContain("/schema/");
  });

  it("returns typed errors for invalid and newer migration inputs", () => {
    expect(migrate(null)).toEqual({
      ok: false,
      error: { kind: "invalid-export" },
    });
    expect(migrate({ schemaVersion: -1 })).toEqual({
      ok: false,
      error: { kind: "invalid-export" },
    });
    expect(migrate({ schemaVersion: 2 })).toEqual({
      ok: false,
      error: {
        kind: "newer-version",
        foundVersion: 2,
        supportedVersion: 1,
      },
    });
  });
});

function withRule(
  envelope: ReturnType<typeof createHeadershimEnvelope>,
  patch: Record<string, unknown>,
): unknown {
  const { profile, rule } = envelopeRule(envelope);
  return {
    ...envelope,
    profiles: [{ ...profile, rules: [{ ...rule, ...patch }] }],
  };
}

function withScope(
  envelope: ReturnType<typeof createHeadershimEnvelope>,
  patch: Record<string, unknown>,
): unknown {
  const { rule } = envelopeRule(envelope);
  return withRule(envelope, { scope: { ...rule.scope, ...patch } });
}

function envelopeRule(envelope: ReturnType<typeof createHeadershimEnvelope>) {
  const profile = envelope.profiles[0];
  const rule = profile?.rules[0];
  if (profile === undefined || rule === undefined) {
    throw new Error("fixture must contain a rule");
  }
  return { profile, rule };
}
