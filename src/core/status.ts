import { domainFromOriginPattern, type RuleGrantGap } from "./grants";
import type { StateDoc } from "./model";

/**
 * The one system-status precedence ladder. The annunciator, badge, and popup
 * actions all read this selector, so the surfaces cannot disagree about what
 * state the product is in.
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
      /** Enabled rules in the active profile — the numerator of "N of M enabled". */
      readonly ruleCount: number;
      /** All rules in the active profile — the denominator; the configured total. */
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

  const active = doc.profiles.find(
    (profile) => profile.id === doc.activeProfileId,
  );
  if (active === undefined) {
    return { kind: "off" };
  }
  return {
    kind: "live",
    ruleCount: active.rules.filter((rule) => rule.enabled).length,
    totalRuleCount: active.rules.length,
    profileCount: 1,
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
