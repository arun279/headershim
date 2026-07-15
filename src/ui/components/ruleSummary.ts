import type { Rule } from "../../core/model";
import { copy, type Sentence } from "../copy";
import { TRUNCATION_LIMITS, truncateEnd } from "./Truncate";

/** The scope line's leading token: the domain (with a +N tail), or its kind. */
export function scopeSummary(rule: Rule): Sentence {
  switch (rule.scope.type) {
    case "domains": {
      const [first] = rule.scope.domains;
      return first === undefined
        ? []
        : copy.scopeSummary.domains(
            truncateEnd(first, TRUNCATION_LIMITS.domain),
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
