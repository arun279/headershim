import { describe, expect, it } from "vitest";
import { confirm, type Projection } from "../../core/applied";
import type { GrantSnapshot } from "../../core/grants";
import type { Profile, Rule, StateDoc, TabOverride } from "../../core/model";
import { overrideKey, ruleKey } from "../../core/verdict";
import { confirmedBatch } from "../test/fixtures";
import { projectFleet } from "./fleet-project";
import { projectTab, type TabContext } from "./project";

const ALL_SITES: GrantSnapshot = {
  origins: ["<all_urls>"],
  allSites: true,
};

const EXAMPLE_TAB: TabContext = {
  tabId: 42,
  host: "example.com",
  origin: "https://example.com",
};

function storedRule(num: number, changes: Partial<Rule> = {}): Rule {
  return {
    id: `rule-${num}`,
    num,
    direction: "request",
    operation: "set",
    header: "x-projection",
    value: `${num}`,
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...changes,
  };
}

function profile(rules: Rule[]): Profile {
  return {
    id: "active",
    name: "Active",
    badgeText: "AC",
    color: "blue",
    rules,
  };
}

function state(rules: Rule[]): StateDoc {
  return {
    v: 1,
    profiles: [profile(rules)],
    activeProfileId: "active",
    nextRuleNum: 100,
    settings: { paused: false, theme: "system" },
  };
}

function compiledApplied(
  rules: Rule[],
  overrides: readonly TabOverride[] = [],
  granted: GrantSnapshot = ALL_SITES,
) {
  return confirmedBatch({
    doc: state(rules),
    overrides,
    granted,
    isRegexSupported: () => true,
  });
}

function twoDomainRule(): Rule {
  return storedRule(1, {
    scope: {
      type: "domains",
      domains: ["example.com", "other.com"],
    },
  });
}

function projectedOutcome(
  applied: Projection,
  rule: Rule,
  tab: TabContext = EXAMPLE_TAB,
) {
  return projectTab(applied, tab).get(ruleKey("active", rule.id, 0))?.outcome;
}

function expectRuleAndOverride(
  lines: ReturnType<typeof projectTab>,
  rule: Rule,
  override: TabOverride,
  overrideKind: "pending" | "elsewhere",
): void {
  expect(lines.get(ruleKey("active", rule.id, 0))?.outcome).toEqual({
    kind: "runs",
  });
  expect(lines.get(overrideKey(override.num, 0))?.outcome).toEqual({
    kind: overrideKind,
  });
}

describe("tab projection", () => {
  it("marks a reachable placed rule pending when the revision mismatches", () => {
    const rule = storedRule(1);
    const { batch } = compiledApplied([rule]);
    const live = confirm(
      batch,
      { dynamic: "expected", session: "expected" },
      { dynamic: "stale", session: "stale" },
    );
    if (live.confirmation !== "pending")
      throw new Error("expected pending projection");

    expect(projectedOutcome(live, rule)).toEqual({ kind: "pending" });
    expect(
      projectFleet(live).get(ruleKey("active", rule.id, 0))?.outcome,
    ).toEqual({
      kind: "pending",
      scope: { kind: "sites", domains: ["example.com"] },
    });
  });

  it("resolves partial overlap on the current host", () => {
    const higher = storedRule(1, {
      comment: "higher overlap",
      scope: {
        type: "domains",
        domains: ["a.example", "b.example"],
      },
    });
    const lower = storedRule(2, {
      comment: "lower overlap",
      scope: {
        type: "domains",
        domains: ["a.example", "c.example"],
      },
    });
    const { applied } = compiledApplied([higher, lower]);
    const higherKey = ruleKey("active", higher.id, 0);
    const lowerKey = ruleKey("active", lower.id, 0);

    const shared = projectTab(applied, {
      tabId: 42,
      host: "a.example",
      origin: "https://a.example",
    });
    expect(shared.get(higherKey)?.outcome).toEqual({ kind: "runs" });
    expect(shared.get(lowerKey)?.outcome).toEqual({
      kind: "shadowed",
      by: higherKey,
      label: "higher overlap",
    });

    const lowerOnly = projectTab(applied, {
      tabId: 42,
      host: "c.example",
      origin: "https://c.example",
    });
    expect(lowerOnly.get(higherKey)?.outcome).toEqual({
      kind: "elsewhere",
    });
    expect(lowerOnly.get(lowerKey)?.outcome).toEqual({ kind: "runs" });
  });

  it("lets a session rule outrank a saved rule in the same slot", () => {
    const saved = storedRule(1, {
      comment: "saved credential",
      header: "Authorization",
      value: "saved",
    });
    const override: TabOverride = {
      num: 7,
      tabId: 42,
      origin: "https://example.com",
      direction: "request",
      operation: "set",
      header: "Authorization",
      value: "temporary",
      enabled: true,
    };
    const { applied, batch } = compiledApplied([saved], [override]);
    const savedKey = ruleKey("active", saved.id, 0);
    const overrideRuleKey = overrideKey(override.num, 0);

    expect(
      batch.slots
        .get("request:authorization")
        ?.map(({ key, placement }) => [
          key,
          placement.band,
          placement.priority,
        ]),
    ).toEqual([
      [overrideRuleKey, "session", 10_000],
      [savedKey, "dynamic", 5_000],
    ]);

    const lines = projectTab(applied, EXAMPLE_TAB);
    expect(lines.get(overrideRuleKey)?.outcome).toEqual({ kind: "runs" });
    expect(lines.get(savedKey)?.outcome).toEqual({
      kind: "shadowed",
      by: overrideRuleKey,
      label: "Authorization rule",
    });
  });

  it("keeps a converged dynamic rule live while the session band is pending", () => {
    const saved = storedRule(1, { header: "x-saved" });
    const override: TabOverride = {
      num: 7,
      tabId: 42,
      origin: "https://example.com",
      direction: "request",
      operation: "set",
      header: "x-temporary",
      value: "temporary",
      enabled: true,
    };
    const { batch } = compiledApplied([saved], [override]);
    const live = confirm(
      batch,
      { dynamic: "current", session: "current" },
      { dynamic: "current" },
    );
    if (live.confirmation !== "pending")
      throw new Error("expected partial confirmation");

    const lines = projectTab(live, EXAMPLE_TAB);
    expectRuleAndOverride(lines, saved, override, "pending");
  });

  it("keeps a lower decisive rule uncertain below a URL-filtered rule", () => {
    const conditional = storedRule(1, {
      scope: {
        type: "pattern",
        pattern: "|https://example.com/private",
        hosts: ["example.com"],
      },
    });
    const decisive = storedRule(2);
    const { applied } = compiledApplied([conditional, decisive]);

    const lines = projectTab(applied, EXAMPLE_TAB);
    expect(lines.get(ruleKey("active", conditional.id, 0))?.outcome).toEqual({
      kind: "runs-if-matched",
      undecidable: "url-filter",
    });
    expect(lines.get(ruleKey("active", decisive.id, 0))?.outcome).toEqual({
      kind: "runs-if-matched",
      undecidable: "url-filter",
    });
  });

  it("does not shadow a rule that covers disjoint resource types", () => {
    const stylesheet = storedRule(1, {
      resourceTypes: ["stylesheets"],
    });
    const xhr = storedRule(2, {
      resourceTypes: ["xhr"],
    });
    const { applied } = compiledApplied([stylesheet, xhr]);

    expect(projectedOutcome(applied, stylesheet)).toEqual({
      kind: "runs",
    });
    expect(projectedOutcome(applied, xhr)).toEqual({
      kind: "runs",
    });
  });

  it("does not let an uncertain stylesheet rule contaminate xhr", () => {
    const stylesheet = storedRule(1, {
      scope: {
        type: "pattern",
        pattern: "|https://example.com/private",
        hosts: ["example.com"],
      },
      resourceTypes: ["stylesheets"],
    });
    const xhr = storedRule(2, { resourceTypes: ["xhr"] });
    const { applied } = compiledApplied([stylesheet, xhr]);

    expect(projectedOutcome(applied, stylesheet)).toEqual({
      kind: "runs-if-matched",
      undecidable: "url-filter",
    });
    expect(projectedOutcome(applied, xhr)).toEqual({
      kind: "runs",
    });
  });

  it("ignores a this-tab override owned by another tab", () => {
    const saved = storedRule(1, { header: "authorization" });
    const override: TabOverride = {
      num: 7,
      tabId: 99,
      origin: "https://example.com",
      direction: "request",
      operation: "set",
      header: "authorization",
      value: "temporary",
      enabled: true,
    };
    const { applied } = compiledApplied([saved], [override]);

    const lines = projectTab(applied, EXAMPLE_TAB);
    expectRuleAndOverride(lines, saved, override, "elsewhere");
  });

  it("keeps a running placement when another placement is elsewhere", () => {
    const rule = twoDomainRule();
    const { applied } = compiledApplied([rule], [], {
      origins: ["https://api.example.com/*", "*://*.other.com/*"],
      allSites: false,
    });

    expect(
      projectTab(applied, {
        tabId: 42,
        host: "other.com",
        origin: "https://other.com",
      }).get(ruleKey("active", rule.id, 0))?.outcome,
    ).toEqual({ kind: "runs" });
  });

  it("preserves the missing initiator grant", () => {
    const rule = storedRule(1, {
      scope: { type: "domains", domains: ["api.example.com"] },
      resourceTypes: ["xhr"],
      initiators: ["app.example.com"],
    });
    const { applied } = compiledApplied([rule], [], {
      origins: ["*://*.api.example.com/*"],
      allSites: false,
    });

    expect(
      projectTab(applied, {
        tabId: 42,
        host: "api.example.com",
        origin: "https://api.example.com",
      }).get(ruleKey("active", rule.id, 0))?.outcome,
    ).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted-initiator",
        missing: ["*://*.app.example.com/*"],
      },
    });
  });

  it("attributes a blocked set to the decisive set above an append", () => {
    const winner = storedRule(1, { comment: "winning set" });
    const appended = storedRule(2, { operation: "append" });
    const blocked = storedRule(3, { comment: "blocked set" });
    const { applied } = compiledApplied([winner, appended, blocked]);

    expect(
      projectTab(applied, EXAMPLE_TAB).get(ruleKey("active", blocked.id, 0))
        ?.outcome,
    ).toEqual({
      kind: "shadowed",
      by: ruleKey("active", winner.id, 0),
      label: "winning set",
    });
  });

  it("marks a fully covered fleet rule shadowed", () => {
    const winner = storedRule(1, { comment: "winning set" });
    const blocked = storedRule(2);
    const { applied } = compiledApplied([winner, blocked]);

    expect(
      projectFleet(applied).get(ruleKey("active", blocked.id, 0))?.outcome,
    ).toEqual({
      kind: "shadowed",
      scope: { kind: "sites", domains: ["example.com"] },
      by: ruleKey("active", winner.id, 0),
      label: "winning set",
    });
  });

  it("does not let an overridden removal block an append", () => {
    const winner = storedRule(1, { header: "cookie" });
    const blockedRemoval = storedRule(2, {
      header: "cookie",
      operation: "remove",
      scope: { type: "all" },
    });
    const appended = storedRule(3, {
      header: "cookie",
      operation: "append",
    });
    const { applied } = compiledApplied([winner, blockedRemoval, appended]);

    expect(
      projectFleet(applied).get(ruleKey("active", appended.id, 0))?.outcome,
    ).toEqual({
      kind: "placed",
      scope: { kind: "sites", domains: ["example.com"] },
    });
  });

  it("keeps installed and missing sites distinct after grant narrowing", () => {
    const rule = twoDomainRule();
    const { applied } = compiledApplied([rule], [], {
      origins: ["https://example.com/*"],
      allSites: false,
    });
    const key = ruleKey("active", rule.id, 0);

    expect(projectFleet(applied).get(key)?.outcome).toEqual({
      kind: "partial",
      scope: {
        kind: "sites",
        domains: ["example.com"],
        origins: ["https://example.com"],
      },
      reason: {
        kind: "ungranted",
        missing: ["*://*.example.com/*", "*://*.other.com/*"],
      },
    });
    expect(projectTab(applied, EXAMPLE_TAB).get(key)?.outcome).toEqual({
      kind: "runs",
    });
    expect(
      projectTab(applied, {
        tabId: 42,
        host: "other.com",
        origin: "https://other.com",
      }).get(key)?.outcome,
    ).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted",
        missing: ["*://*.other.com/*"],
      },
    });
  });

  it("projects a matching narrowed anchor as placed and a different scheme as ungranted", () => {
    const rule = storedRule(1, {
      scope: { type: "domains", domains: ["h"] },
    });
    const { applied } = compiledApplied([rule], [], {
      origins: ["https://h/*"],
      allSites: false,
    });
    const key = ruleKey("active", rule.id, 0);

    expect(
      projectTab(applied, {
        tabId: 42,
        host: "h",
        origin: "https://h",
      }).get(key)?.outcome,
    ).toEqual({ kind: "runs" });
    expect(
      projectTab(applied, {
        tabId: 42,
        host: "h",
        origin: "http://h",
      }).get(key)?.outcome,
    ).toEqual({
      kind: "absent",
      reason: { kind: "ungranted", missing: ["*://*.h/*"] },
    });
  });

  it("does not widen an exact subdomain placement to its parent domain", () => {
    const rule = storedRule(1, {
      scope: { type: "domains", domains: ["example.com"] },
    });
    const { applied } = compiledApplied([rule], [], {
      origins: ["https://api.example.com/*"],
      allSites: false,
    });

    expect(
      projectFleet(applied).get(ruleKey("active", rule.id, 0))?.outcome,
    ).toMatchObject({
      scope: { kind: "sites", domains: ["api.example.com"] },
    });
  });

  it("keeps a hostless anchored pattern scoped to its origin", () => {
    const rule = storedRule(1, {
      scope: { type: "pattern", pattern: "|https://example.com^", hosts: [] },
    });
    const { applied } = compiledApplied([rule]);

    expect(
      projectFleet(applied).get(ruleKey("active", rule.id, 0))?.outcome,
    ).toMatchObject({ scope: { kind: "sites", domains: ["example.com"] } });
  });

  it("keeps an exact port grant distinct from its host", () => {
    const rule = storedRule(1, {
      scope: { type: "domains", domains: ["example.com"] },
    });
    const { applied } = compiledApplied([rule], [], {
      origins: ["https://example.com:8443/*"],
      allSites: false,
    });

    expect(
      projectFleet(applied).get(ruleKey("active", rule.id, 0))?.outcome,
    ).toEqual({
      kind: "partial",
      scope: {
        kind: "sites",
        domains: ["example.com"],
        origins: ["https://example.com:8443"],
      },
      reason: {
        kind: "ungranted",
        missing: ["*://*.example.com/*"],
      },
    });
  });
});
