import type { SensitiveHeaderClass } from "../../core/headers";
import type { Rule, Scope } from "../../core/model";
import { copy, type Sentence } from "../copy";
import { truncateMiddle } from "./Truncate";

/**
 * The advisory line for a sensitive header, escalated when the rule's scope
 * reaches every site. Shared by the rule editor and the import review so the two
 * surfaces read the exact same warning.
 */
export function sensitiveAdvisoryText(
  kind: SensitiveHeaderClass,
  broad: boolean,
): string {
  if (kind === "security-response") {
    return broad
      ? copy.advisories.securityHeaderBroad
      : copy.advisories.securityHeader;
  }
  return broad
    ? copy.advisories.credentialHeaderBroad
    : copy.advisories.credentialHeader;
}

// The clamped line 2 (nowrap + ellipsis) would end-clip a pathologically long
// domain and lose its registrable tail; middle-truncating first keeps the tail.
const SCOPE_DOMAIN_MAX = 44;

/** The scope line's leading token: the domain (with a +N tail), or its kind. */
export function scopeSummary(rule: Rule): Sentence {
  return scopeSummaryFor(rule.scope);
}

/** The same summary from a bare scope — for an import-plan draft with no id/num. */
export function scopeSummaryFor(scope: Scope): Sentence {
  switch (scope.type) {
    case "domains": {
      const [first] = scope.domains;
      return first === undefined
        ? []
        : copy.scopeSummary.domains(
            truncateMiddle(first, SCOPE_DOMAIN_MAX),
            scope.domains.length - 1,
          );
    }
    case "pattern":
      return [copy.scopeSummary.pattern];
    case "regex":
      return [copy.scopeSummary.regex];
    case "all":
      return [copy.scopeSummary.allSites];
  }
}

/** A compact resource-type readout, or undefined when the rule targets all. */
export function typesSummary(rule: Rule): string | undefined {
  if (rule.resourceTypes === "all") {
    return undefined;
  }
  const names = rule.resourceTypes.map(
    (group) => copy.resourceTypes.groups[group],
  );
  if (names.length === 1) {
    return copy.resourceTypes.only(names[0] as string);
  }
  return names.length === 2
    ? names.join(", ")
    : copy.resourceTypes.count(names.length);
}
