import { describe, expect, it } from "vitest";
import type { GrantSnapshot } from "../../core/grants";
import type { Rule, StateDoc } from "../../core/model";
import { copy } from "../copy";
import { createdRuleToast } from "./overridden";

const ALL: GrantSnapshot = { origins: [], allSites: true };
const SUPPORTED = () => true;

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "r1",
  num: 1,
  direction: "request",
  operation: "set",
  header: "authorization",
  value: "Bearer x",
  scope: { type: "domains", domains: ["api.example.com"] },
  resourceTypes: "all",
  initiators: [],
  enabled: true,
  ...overrides,
});

const docWith = (rules: Rule[]): StateDoc => ({
  v: 1,
  profiles: [
    { id: "p1", name: "Default", badgeText: "DE", color: "indigo", rules },
  ],
  activeProfileId: "p1",
  nextRuleNum: 100,
  settings: { paused: false, theme: "system" },
});

describe("createdRuleToast", () => {
  it("names the winner when the saved rule lands overridden by one above it", () => {
    const existing = rule({ id: "existing", num: 1, comment: "primary auth" });
    const saved = rule({ id: "dupe", num: 2 });

    expect(
      createdRuleToast(docWith([existing]), "p1", saved, ALL, SUPPORTED),
    ).toBe(copy.toast.ruleCreatedOverridden("primary auth"));
  });

  it("reports a plain success when nothing above shadows the saved rule", () => {
    const existing = rule({ id: "existing", num: 1, header: "x-trace" });
    const saved = rule({ id: "fresh", num: 2 });

    expect(
      createdRuleToast(docWith([existing]), "p1", saved, ALL, SUPPORTED),
    ).toBe(copy.toast.ruleCreated);
  });
});
