import { type Applied, confirm } from "../../core/applied";
import { type CompileInput, compile } from "../../core/compile";
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
    activeProfileId: profiles[0]?.id ?? "",
    nextRuleNum: seq + 1,
    settings: { paused: false, theme: "system" },
    ...overrides,
  };
}

export function confirmedBatch(input: CompileInput): {
  readonly applied: Applied;
  readonly batch: ReturnType<typeof compile>;
} {
  const batch = compile(input);
  const revision = { dynamic: "dynamic", session: "session" };
  const live = confirm(batch, revision, revision);
  if (live.confirmation !== "applied") {
    throw new Error("matching compiled revision was not confirmed");
  }
  return { applied: live, batch };
}
