import { describe, expect, it } from "vitest";
import {
  checkEnabledRuleLimits,
  checkSessionOverrideLimit,
  checkStateDocByteLimit,
  MAX_DOC_BYTES,
  MAX_ENABLED_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
  RULE_COUNT_WARNING_THRESHOLD,
  serializedStateDocBytes,
  shouldShowRuleCountWarning,
} from "./limits";
import type { Profile, Rule, StateDoc } from "./model";

function storedRule(num: number, regex = false, enabled = true): Rule {
  return {
    id: `rule-${num}`,
    num,
    direction: "request",
    operation: "set",
    header: "x-debug",
    value: "on",
    scope: regex
      ? {
          type: "regex",
          regex: `^https://host-${num}\\.example/`,
          hosts: [`host-${num}.example`],
        }
      : { type: "domains", domains: [`host-${num}.example`] },
    resourceTypes: "all",
    initiators: [],
    enabled,
  };
}

function rules(
  count: number,
  options: { start?: number; regexCount?: number; enabledCount?: number } = {},
): Rule[] {
  const start = options.start ?? 1;
  const regexCount = options.regexCount ?? 0;
  const enabledCount = options.enabledCount ?? count;
  return Array.from({ length: count }, (_, index) =>
    storedRule(start + index, index < regexCount, index < enabledCount),
  );
}

function profile(id: string, profileRules: Rule[]): Profile {
  return {
    id,
    name: id,
    badgeText: id.slice(0, 2),
    color: "blue",
    rules: profileRules,
  };
}

function state(...profiles: Profile[]): StateDoc {
  return {
    v: 1,
    profiles,
    activeProfileId: profiles[0]?.id,
    nextRuleNum: 10_000,
    settings: { paused: false, theme: "system", badgeMode: "count" },
  };
}

function enabledRules(doc: StateDoc): Rule[] {
  const active = doc.profiles.find(
    (profile) => profile.id === doc.activeProfileId,
  );
  return active === undefined
    ? []
    : active.rules.filter((rule) => rule.enabled);
}

function expectBoundary(
  doc: StateDoc,
  overflowRule: Rule,
  error: {
    kind: "enabled-rule-limit-exceeded" | "regex-rule-limit-exceeded";
    count: number;
    limit: number;
  },
): void {
  expect(checkEnabledRuleLimits(enabledRules(doc))).toEqual({
    ok: true,
    value: undefined,
  });

  const candidateProfile = doc.profiles[0];
  if (candidateProfile === undefined) {
    throw new Error("fixture must contain a profile");
  }
  candidateProfile.rules.push(overflowRule);

  expect(checkEnabledRuleLimits(enabledRules(doc))).toEqual({
    ok: false,
    error,
  });
}

describe("enabled rule limits", () => {
  it("checks an enabled rule created by a save at both boundaries", () => {
    const enabledSave = state(profile("saved", rules(MAX_ENABLED_RULES - 1)));
    enabledSave.profiles[0]?.rules.push(storedRule(MAX_ENABLED_RULES));
    expectBoundary(enabledSave, storedRule(9_999), {
      kind: "enabled-rule-limit-exceeded",
      count: MAX_ENABLED_RULES + 1,
      limit: MAX_ENABLED_RULES,
    });

    const regexSave = state(
      profile(
        "regex-save",
        rules(MAX_REGEX_RULES - 1, { regexCount: MAX_REGEX_RULES - 1 }),
      ),
    );
    regexSave.profiles[0]?.rules.push(storedRule(MAX_REGEX_RULES, true));
    expectBoundary(regexSave, storedRule(9_999, true), {
      kind: "regex-rule-limit-exceeded",
      count: MAX_REGEX_RULES + 1,
      limit: MAX_REGEX_RULES,
    });
  });

  it("checks a disabled rule being toggled on at both boundaries", () => {
    const enabledToggle = state(
      profile(
        "toggle",
        rules(MAX_ENABLED_RULES + 1, {
          enabledCount: MAX_ENABLED_RULES - 1,
        }),
      ),
    );
    const toggleRules = enabledToggle.profiles[0]?.rules;
    if (toggleRules === undefined) {
      throw new Error("fixture must contain rules");
    }
    const firstDisabled = toggleRules[MAX_ENABLED_RULES - 1];
    const secondDisabled = toggleRules[MAX_ENABLED_RULES];
    if (firstDisabled === undefined || secondDisabled === undefined) {
      throw new Error("fixture must contain disabled rules");
    }
    firstDisabled.enabled = true;
    expect(checkEnabledRuleLimits(enabledRules(enabledToggle)).ok).toBe(true);
    secondDisabled.enabled = true;
    expect(checkEnabledRuleLimits(enabledRules(enabledToggle))).toMatchObject({
      ok: false,
      error: { kind: "enabled-rule-limit-exceeded", count: 4_501 },
    });

    const regexToggle = state(
      profile(
        "regex-toggle",
        rules(MAX_REGEX_RULES + 1, {
          regexCount: MAX_REGEX_RULES + 1,
          enabledCount: MAX_REGEX_RULES - 1,
        }),
      ),
    );
    const regexToggleRules = regexToggle.profiles[0]?.rules;
    if (regexToggleRules === undefined) {
      throw new Error("fixture must contain regex rules");
    }
    const firstDisabledRegex = regexToggleRules[MAX_REGEX_RULES - 1];
    const secondDisabledRegex = regexToggleRules[MAX_REGEX_RULES];
    if (firstDisabledRegex === undefined || secondDisabledRegex === undefined) {
      throw new Error("fixture must contain disabled regex rules");
    }
    firstDisabledRegex.enabled = true;
    expect(checkEnabledRuleLimits(enabledRules(regexToggle)).ok).toBe(true);
    secondDisabledRegex.enabled = true;
    expect(checkEnabledRuleLimits(enabledRules(regexToggle))).toMatchObject({
      ok: false,
      error: { kind: "regex-rule-limit-exceeded", count: 1_001 },
    });
  });

  it("checks all rules activated by enabling a profile", () => {
    const atEnabledLimit = state(
      profile("active", rules(1)),
      profile("activated", rules(4_500)),
    );
    const activated = atEnabledLimit.profiles[1];
    if (activated === undefined) {
      throw new Error("fixture must contain the profile being enabled");
    }
    atEnabledLimit.activeProfileId = activated.id;
    expect(checkEnabledRuleLimits(enabledRules(atEnabledLimit)).ok).toBe(true);
    activated.rules.push(storedRule(4_501));
    expect(checkEnabledRuleLimits(enabledRules(atEnabledLimit))).toMatchObject({
      ok: false,
      error: { kind: "enabled-rule-limit-exceeded", count: 4_501 },
    });

    const atRegexLimit = state(
      profile("active-regex", rules(1)),
      profile("activated-regex", rules(1_000, { regexCount: 1_000 })),
    );
    const activatedRegex = atRegexLimit.profiles[1];
    if (activatedRegex === undefined) {
      throw new Error("fixture must contain the regex profile being enabled");
    }
    atRegexLimit.activeProfileId = activatedRegex.id;
    expect(checkEnabledRuleLimits(enabledRules(atRegexLimit)).ok).toBe(true);
    activatedRegex.rules.push(storedRule(1_001, true));
    expect(checkEnabledRuleLimits(enabledRules(atRegexLimit))).toMatchObject({
      ok: false,
      error: { kind: "regex-rule-limit-exceeded", count: 1_001 },
    });
  });

  it("checks imported profiles when they are enabled", () => {
    const importedEnabled = state(profile("existing", rules(1)));
    importedEnabled.profiles.push(profile("imported", rules(4_500)));
    const importedProfile = importedEnabled.profiles[1];
    if (importedProfile === undefined) {
      throw new Error("fixture must contain the imported profile");
    }
    importedEnabled.activeProfileId = importedProfile.id;
    expect(checkEnabledRuleLimits(enabledRules(importedEnabled)).ok).toBe(true);
    importedProfile.rules.push(storedRule(4_501));
    expect(checkEnabledRuleLimits(enabledRules(importedEnabled))).toMatchObject(
      {
        ok: false,
        error: { kind: "enabled-rule-limit-exceeded", count: 4_501 },
      },
    );

    const importedRegex = state(profile("existing-regex", rules(1)));
    importedRegex.profiles.push(
      profile("imported-regex", rules(1_000, { regexCount: 1_000 })),
    );
    const importedRegexProfile = importedRegex.profiles[1];
    if (importedRegexProfile === undefined) {
      throw new Error("fixture must contain the imported regex profile");
    }
    importedRegex.activeProfileId = importedRegexProfile.id;
    expect(checkEnabledRuleLimits(enabledRules(importedRegex)).ok).toBe(true);
    importedRegexProfile.rules.push(storedRule(1_001, true));
    expect(checkEnabledRuleLimits(enabledRules(importedRegex))).toMatchObject({
      ok: false,
      error: { kind: "regex-rule-limit-exceeded", count: 1_001 },
    });
  });
});

describe("session and storage limits", () => {
  it("allows 1,000 session overrides and rejects the next row", () => {
    expect(checkSessionOverrideLimit(MAX_SESSION_OVERRIDES)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(checkSessionOverrideLimit(MAX_SESSION_OVERRIDES + 1)).toEqual({
      ok: false,
      error: {
        kind: "session-override-limit-exceeded",
        count: 1_001,
        limit: MAX_SESSION_OVERRIDES,
      },
    });
  });

  it("allows a document at exactly 4 MB and rejects one byte more", () => {
    const doc = state(profile("storage", [storedRule(1)]));
    const stored = doc.profiles[0]?.rules[0];
    if (stored === undefined) {
      throw new Error("fixture must contain a stored rule");
    }
    stored.value = "";
    stored.value = "x".repeat(MAX_DOC_BYTES - serializedStateDocBytes(doc));

    expect(serializedStateDocBytes(doc)).toBe(MAX_DOC_BYTES);
    expect(checkStateDocByteLimit(doc).ok).toBe(true);

    stored.value += "x";
    expect(checkStateDocByteLimit(doc)).toEqual({
      ok: false,
      error: {
        kind: "doc-byte-limit-exceeded",
        bytes: MAX_DOC_BYTES + 1,
        limit: MAX_DOC_BYTES,
      },
    });
  });

  it("measures serialized multi-byte header values as UTF-8", () => {
    const doc = state(profile("utf8", [storedRule(1)]));
    const stored = doc.profiles[0]?.rules[0];
    if (stored === undefined) {
      throw new Error("fixture must contain a stored rule");
    }
    stored.value = "界".repeat(1_400_000);

    expect(JSON.stringify(doc).length).toBeLessThan(MAX_DOC_BYTES);
    expect(serializedStateDocBytes(doc)).toBeGreaterThan(MAX_DOC_BYTES);
    expect(checkStateDocByteLimit(doc)).toMatchObject({
      ok: false,
      error: { kind: "doc-byte-limit-exceeded" },
    });
  });
});

describe("rule count warning", () => {
  it("appears only after the 4,000-rule threshold", () => {
    expect(RULE_COUNT_WARNING_THRESHOLD).toBe(4_000);
    expect(shouldShowRuleCountWarning(3_999)).toBe(false);
    expect(shouldShowRuleCountWarning(4_000)).toBe(false);
    expect(shouldShowRuleCountWarning(4_001)).toBe(true);
  });
});
