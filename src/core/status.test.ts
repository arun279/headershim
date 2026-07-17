import { describe, expect, it } from "vitest";
import type { RuleGrantGap } from "./grants";
import type { Profile, Rule, StateDoc } from "./model";
import { computeStatus } from "./status";

function rule(num: number, enabled = true): Rule {
  return {
    id: `rule-${num}`,
    num,
    direction: "request",
    operation: "set",
    header: "x-test",
    value: "1",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled,
  };
}

function profile(id: string, rules: Rule[] = []): Profile {
  return { id, name: id, badgeText: "DE", color: "indigo", rules };
}

function doc(profiles: Profile[], paused = false): StateDoc {
  return {
    v: 1,
    profiles,
    activeProfileId: profiles[0]?.id,
    nextRuleNum: 100,
    settings: { paused, theme: "system", badgeMode: "count" },
  };
}

const gap = (ruleId: string, missing: string[]): RuleGrantGap => ({
  profileId: "p1",
  ruleId,
  missing,
});

describe("computeStatus precedence", () => {
  const gaps = [gap("r1", ["*://*.api.example.com/*"])];

  it("puts paused above everything", () => {
    const status = computeStatus({
      doc: doc([profile("p1", [rule(1)])], true),
      grantGaps: gaps,
      reconcileError: true,
    });
    expect(status).toEqual({ kind: "paused" });
  });

  it("puts a failed reconcile above a missing grant", () => {
    const status = computeStatus({
      doc: doc([profile("p1", [rule(1)])]),
      grantGaps: gaps,
      reconcileError: true,
    });
    expect(status).toEqual({ kind: "out-of-sync" });
  });

  it("reports needs-access with the affected rule count and hosts", () => {
    const status = computeStatus({
      doc: doc([profile("p1", [rule(1), rule(2)])]),
      grantGaps: [
        gap("r1", ["*://*.api.example.com/*", "*://*.app.example.com/*"]),
        gap("r2", ["*://*.api.example.com/*"]),
      ],
      reconcileError: false,
    });
    expect(status).toEqual({
      kind: "needs-access",
      ruleCount: 2,
      hosts: ["api.example.com", "app.example.com"],
    });
  });

  it("passes through origins that are not per-domain patterns", () => {
    const status = computeStatus({
      doc: doc([profile("p1", [rule(1)])]),
      grantGaps: [gap("r1", ["*://*/*"])],
      reconcileError: false,
    });
    expect(status).toMatchObject({ hosts: ["*://*/*"] });
  });

  it("counts enabled rules in the active profile only", () => {
    const status = computeStatus({
      doc: doc([
        profile("p1", [rule(1), rule(2, false)]),
        profile("p2", [rule(3)]),
        profile("p3", [rule(4)]),
      ]),
      grantGaps: [],
      reconcileError: false,
    });
    expect(status).toEqual({
      kind: "live",
      ruleCount: 1,
      totalRuleCount: 2,
      profileCount: 1,
    });
  });

  it("is off when no profile is active", () => {
    const status = computeStatus({
      doc: { ...doc([profile("p1", [rule(1)])]), activeProfileId: undefined },
      grantGaps: [],
      reconcileError: false,
    });
    expect(status).toEqual({ kind: "off" });
  });
});
