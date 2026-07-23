import { domainFromOriginPattern, type RuleGrantGap } from "./grants";
import { activeProfile, type StateDoc } from "./model";

/**
 * The one system-status precedence ladder. The annunciator, the badge, the
 * popup readout and the Workbench fleet all read this selector, so the surfaces
 * cannot disagree about what state the product is in: when it reports
 * out-of-sync, no line anywhere may still read live.
 */
export type SystemStatus =
  | { readonly kind: "paused" }
  | { readonly kind: "out-of-sync" }
  | {
      readonly kind: "needs-access";
      readonly ruleCount: number;
      readonly hosts: readonly string[];
    }
  // No count rides along: a rule being enabled is not a rule Chrome is running
  // (the compiler drops whatever uncompilableReason names), so any tally here
  // would be a claim this selector cannot make. Surfaces that need one count
  // the projected lines, which carry each rule's real state.
  | { readonly kind: "live" }
  | { readonly kind: "off" };

export interface StatusInput {
  readonly doc: StateDoc;
  readonly grantGaps: readonly RuleGrantGap[];
  readonly reconcileError: boolean;
}

export function computeStatus({
  doc,
  grantGaps,
  reconcileError,
}: StatusInput): SystemStatus {
  if (doc.settings.paused) {
    return { kind: "paused" };
  }
  // A failed reconcile outranks a missing grant: it means even the granted
  // picture may not be what is actually applied.
  if (reconcileError) {
    return { kind: "out-of-sync" };
  }
  if (grantGaps.length > 0) {
    return {
      kind: "needs-access",
      ruleCount: grantGaps.length,
      hosts: gapHosts(grantGaps),
    };
  }

  return activeProfile(doc) !== undefined ? { kind: "live" } : { kind: "off" };
}

function gapHosts(gaps: readonly RuleGrantGap[]): string[] {
  const hosts: string[] = [];
  for (const gap of gaps) {
    for (const origin of gap.missing) {
      const host = domainFromOriginPattern(origin) ?? origin;
      if (!hosts.includes(host)) {
        hosts.push(host);
      }
    }
  }
  return hosts;
}
