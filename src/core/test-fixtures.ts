import type { Profile, Rule, StateDoc } from "./model";

export function profile(id: string, rules: Rule[]): Profile {
  return {
    id,
    name: id,
    badgeText: id.slice(0, 2),
    color: "blue",
    rules,
  };
}

export function makeDoc(profiles: Profile[]): StateDoc {
  return {
    v: 1,
    profiles,
    activeProfileId: profiles[0]?.id,
    nextRuleNum: 1_000,
    settings: { paused: false, theme: "system", badgeMode: "count" },
  };
}
