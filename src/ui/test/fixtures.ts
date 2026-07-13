import type { Profile, Rule, StateDoc } from "../../core/model";

let seq = 0;

/** Resets the auto-incrementing rule id/num counter; call from beforeEach. */
export function resetFixtures(): void {
  seq = 0;
}

export function rule(overrides: Partial<Rule> = {}): Rule {
  seq += 1;
  return {
    id: `rule-${seq}`,
    num: seq,
    direction: "request",
    operation: "set",
    header: "x-test",
    value: "1",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

export function rules(count: number, overrides: Partial<Rule> = {}): Rule[] {
  return Array.from({ length: count }, () => rule(overrides));
}

export function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    name: id,
    badgeText: "DE",
    color: "indigo",
    enabled: true,
    rules: [],
    ...overrides,
  };
}

export function stateDoc(
  profiles: Profile[],
  overrides: Partial<StateDoc> = {},
): StateDoc {
  return {
    v: 1,
    profiles,
    focusedProfileId: profiles[0]?.id ?? "",
    nextRuleNum: seq + 1,
    settings: { paused: false, theme: "system", badgeMode: "count" },
    ...overrides,
  };
}
