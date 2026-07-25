import { dropInapplicable } from "../../core/compile";
import { findOverriddenRules } from "../../core/conflicts";
import type { GrantSnapshot } from "../../core/grants";
import { activeProfile, type Rule, type StateDoc } from "../../core/model";
import { copy } from "../copy";

/** The label a shadowed row shows for the rule that wins over it. */
function ruleLabel(rule: Rule): string {
  const comment = rule.comment?.trim();
  return comment === undefined || comment.length === 0
    ? `${rule.header} rule`
    : comment;
}

/**
 * The one source of "which active rule is shadowed by which", keyed by rule id
 * to the winner's label. Collisions resolve over the exact rules Chrome
 * installs, so every surface that reads this map — the popup readout, the fleet
 * list, the create toast — agrees with the wire and with each other.
 */
export function overriddenLabels(
  doc: StateDoc,
  grants: GrantSnapshot,
  isRegexSupported: (regex: string) => boolean,
): Map<string, string> {
  const installed = activeProfile(
    dropInapplicable(doc, isRegexSupported, grants),
  ).rules;
  const byId = new Map(installed.map((rule) => [rule.id, rule]));
  const labels = new Map<string, string>();
  for (const { ruleId, shadowedByRuleId } of findOverriddenRules(installed)) {
    const winner = byId.get(shadowedByRuleId);
    if (winner !== undefined) {
      labels.set(ruleId, ruleLabel(winner));
    }
  }
  return labels;
}

/**
 * What to announce for a rule the user just saved into `profileId`: the same
 * verdict the row it lands in will show. A rule the product can already see is
 * inert is announced as overridden rather than as a neutral success.
 */
export function createdRuleToast(
  doc: StateDoc,
  profileId: string,
  saved: Rule,
  grants: GrantSnapshot,
  isRegexSupported: (regex: string) => boolean,
): string {
  const withSaved: StateDoc = {
    ...doc,
    profiles: doc.profiles.map((profile) =>
      profile.id === profileId
        ? { ...profile, rules: [...profile.rules, saved] }
        : profile,
    ),
  };
  const winner = overriddenLabels(withSaved, grants, isRegexSupported).get(
    saved.id,
  );
  return winner === undefined
    ? copy.toast.ruleCreated
    : copy.toast.ruleCreatedOverridden(winner);
}
