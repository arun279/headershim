import type { DecodedMatch } from "./matches";
import type { Profile, Rule } from "./model";

interface VerifyMatchedRule {
  readonly profileId: string;
  readonly rule: Rule;
  readonly count: number;
}

export interface VerifyReadout {
  readonly matched: readonly VerifyMatchedRule[];
}

export interface VerifyInput {
  /** The enabled profiles whose rules Verify reports on. */
  readonly profiles: readonly Profile[];
  /** Decoded matches for the tab; stable-id attribution from `decodeMatches`. */
  readonly matches: readonly DecodedMatch[];
}

/**
 * Turns decoded matches into the enabled-profile rules that fired and their
 * tallies. Tallies come from `decodeMatches`, so a deleted rule's retained
 * matches are already dropped and session matches never leak into the
 * profile-rule count.
 */
export function summarizeVerify(input: VerifyInput): VerifyReadout {
  const counts = new Map<number, number>();
  for (const match of input.matches) {
    if (match.kind === "dynamic") {
      counts.set(match.rule.num, (counts.get(match.rule.num) ?? 0) + 1);
    }
  }

  const matched: VerifyMatchedRule[] = [];
  for (const profile of input.profiles) {
    for (const rule of profile.rules) {
      const count = counts.get(rule.num) ?? 0;
      if (count > 0) {
        matched.push({ profileId: profile.id, rule, count });
      }
    }
  }

  return { matched };
}
