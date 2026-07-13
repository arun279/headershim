import { domainFromOriginPattern, type RuleGrantGap } from "./grants";
import type { StateDoc } from "./model";

/**
 * The one system-status precedence ladder. The annunciator, the badge, and
 * Verify's hints all read this selector, so the three surfaces can never
 * disagree about what state the product is in.
 */
export type SystemStatus =
  | { readonly kind: "paused" }
  | { readonly kind: "out-of-sync" }
  | {
      readonly kind: "needs-access";
      readonly ruleCount: number;
      readonly hosts: readonly string[];
    }
  | {
      readonly kind: "live";
      /** Enabled rules in enabled profiles — the numerator of "N of M enabled". */
      readonly ruleCount: number;
      /** All rules in enabled profiles — the denominator; the configured total. */
      readonly totalRuleCount: number;
      readonly profileCount: number;
    }
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

  const enabled = doc.profiles.filter((profile) => profile.enabled);
  if (enabled.length === 0) {
    return { kind: "off" };
  }
  return {
    kind: "live",
    ruleCount: enabled.reduce(
      (count, profile) =>
        count + profile.rules.filter((rule) => rule.enabled).length,
      0,
    ),
    totalRuleCount: enabled.reduce(
      (count, profile) => count + profile.rules.length,
      0,
    ),
    profileCount: enabled.length,
  };
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
