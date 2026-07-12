import type { Rule, StateDoc, TabOverride } from "./model";

export const DYNAMIC_RULESET_ID = "_dynamic";
export const SESSION_RULESET_ID = "_session";

export interface RawRuleMatch {
  rule: {
    ruleId: number;
    rulesetId: string;
  };
  tabId: number;
  timeStamp: number;
}

export type DecodedMatch =
  | {
      kind: "dynamic";
      profileId: string;
      rule: Rule;
      tabId: number;
      timeStamp: number;
    }
  | {
      kind: "session";
      override: TabOverride;
      tabId: number;
      timeStamp: number;
    };

export function decodeMatches(
  state: StateDoc,
  overrides: readonly TabOverride[],
  rawMatches: readonly RawRuleMatch[],
): DecodedMatch[] {
  const dynamicRules = new Map(
    state.profiles.flatMap((profile) =>
      profile.rules.map(
        (rule) => [rule.num, { profileId: profile.id, rule }] as const,
      ),
    ),
  );
  const sessionRules = new Map(
    overrides.map((override) => [override.num, override]),
  );

  return rawMatches.flatMap((match): DecodedMatch[] => {
    if (match.rule.rulesetId === DYNAMIC_RULESET_ID) {
      const attribution = dynamicRules.get(match.rule.ruleId);
      return attribution === undefined
        ? []
        : [
            {
              kind: "dynamic",
              ...attribution,
              tabId: match.tabId,
              timeStamp: match.timeStamp,
            },
          ];
    }
    if (match.rule.rulesetId === SESSION_RULESET_ID) {
      const override = sessionRules.get(match.rule.ruleId);
      return override === undefined
        ? []
        : [
            {
              kind: "session",
              override,
              tabId: match.tabId,
              timeStamp: match.timeStamp,
            },
          ];
    }
    return [];
  });
}
