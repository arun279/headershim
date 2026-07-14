import type { Rule } from "../../core/model";
import { copy, type Sentence } from "../copy";
import { truncateMiddle } from "./Truncate";

// The clamped line 2 (nowrap + ellipsis) would end-clip a pathologically long
// domain and lose its registrable tail; middle-truncating first keeps the tail.
const SCOPE_DOMAIN_MAX = 44;

/** The scope line's leading token: the domain (with a +N tail), or its kind. */
export function scopeSummary(rule: Rule): Sentence {
  switch (rule.scope.type) {
    case "domains": {
      const [first] = rule.scope.domains;
      return first === undefined
        ? []
        : copy.scopeSummary.domains(
            truncateMiddle(first, SCOPE_DOMAIN_MAX),
            rule.scope.domains.length - 1,
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
