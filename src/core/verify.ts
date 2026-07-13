import type { DecodedMatch } from "./matches";
import type { Profile, Rule, Scope } from "./model";

/**
 * The only causes Verify may name for a rule that matched nothing. Each is
 * provable from the stored rules, the tab's own site, and the grant snapshot
 * alone — never from which requests actually occurred, which headershim does
 * not record. Everything else a zero match could mean (a cached response, a
 * resource-type mismatch, an unnamed initiator) stays in the panel's hedged
 * general guidance, never a per-rule verdict.
 */
export type VerifyHint = "disabled" | "scope-excludes" | "needs-access";

interface VerifyMatchedRule {
  readonly profileId: string;
  readonly rule: Rule;
  readonly count: number;
}

export interface VerifyUnmatchedRule {
  readonly profileId: string;
  readonly rule: Rule;
  readonly hint?: VerifyHint;
}

export interface VerifyReadout {
  readonly matched: readonly VerifyMatchedRule[];
  readonly unmatched: readonly VerifyUnmatchedRule[];
  /** matched + unmatched: the denominator of the honest fraction summary. */
  readonly total: number;
}

export interface VerifyInput {
  /** The enabled profiles whose rules Verify reports on. */
  readonly profiles: readonly Profile[];
  /** Decoded matches for the tab; stable-id attribution from `decodeMatches`. */
  readonly matches: readonly DecodedMatch[];
  /** The tab's own host when it is a web origin; enables the scope-excludes hint. */
  readonly tabHost: string | undefined;
  /** Ids of rules missing a grant they need (target or named initiator). */
  readonly needsAccessRuleIds: ReadonlySet<string>;
}

/**
 * Turns decoded matches into the per-rule readout: which enabled-profile rules
 * fired and how often, which did not, and — for those — the single static cause
 * we can stand behind. Tallies come from `decodeMatches`, so a deleted rule's
 * retained matches are already dropped and session matches never leak into the
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
  const unmatched: VerifyUnmatchedRule[] = [];
  for (const profile of input.profiles) {
    for (const rule of profile.rules) {
      const count = counts.get(rule.num) ?? 0;
      if (count > 0) {
        matched.push({ profileId: profile.id, rule, count });
        continue;
      }
      const hint = staticHint(rule, input.tabHost, input.needsAccessRuleIds);
      unmatched.push({
        profileId: profile.id,
        rule,
        ...(hint === undefined ? {} : { hint }),
      });
    }
  }

  return { matched, unmatched, total: matched.length + unmatched.length };
}

function staticHint(
  rule: Rule,
  tabHost: string | undefined,
  needsAccessRuleIds: ReadonlySet<string>,
): VerifyHint | undefined {
  if (!rule.enabled) {
    return "disabled";
  }
  if (scopeExcludes(rule.scope, tabHost)) {
    return "scope-excludes";
  }
  if (needsAccessRuleIds.has(rule.id)) {
    return "needs-access";
  }
  return undefined;
}

/**
 * True only when the scope provably cannot cover the tab's own site. Provable
 * for a Domains scope against a known host; a pattern or regex scope is left
 * unproven (no honest static verdict without running Chrome's match engine),
 * and an unknown host (chrome://, store pages) proves nothing. Resource types
 * are deliberately not consulted: a resource-type mismatch is a non-static
 * cause, and per-rule verdicts deliberately exclude those.
 */
function scopeExcludes(scope: Scope, tabHost: string | undefined): boolean {
  if (tabHost === undefined || scope.type !== "domains") {
    return false;
  }
  return !scope.domains.some(
    (domain) => tabHost === domain || tabHost.endsWith(`.${domain}`),
  );
}
