import { normalizeHeaderName } from "./headers";
import type { Rule, Scope } from "./model";
import { expandResourceTypes } from "./scope";

export interface OverriddenRule {
  readonly ruleId: string;
  readonly shadowedByRuleId: string;
}

export function findOverriddenRules(rules: readonly Rule[]): OverriddenRule[] {
  const overridden: OverriddenRule[] = [];
  const overriddenIds = new Set<string>();
  const earlierByHeader = new Map<string, Rule[]>();

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    const header = normalizeHeaderName(rule.header);
    const earlierRules = earlierByHeader.get(header) ?? [];
    const shadowingRule = earlierRules.find(
      (candidate) =>
        !overriddenIds.has(candidate.id) && shadows(candidate, rule),
    );
    if (shadowingRule !== undefined) {
      overridden.push({
        ruleId: rule.id,
        shadowedByRuleId: shadowingRule.id,
      });
      overriddenIds.add(rule.id);
    }
    earlierRules.push(rule);
    earlierByHeader.set(header, earlierRules);
  }

  return overridden;
}

function shadows(earlier: Rule, later: Rule): boolean {
  if (later.operation === "append" && earlier.operation !== "remove") {
    return false;
  }
  return (
    earlier.direction === later.direction &&
    resourceTypesContain(earlier.resourceTypes, later.resourceTypes) &&
    scopeContains(earlier.scope, later.scope) &&
    initiatorsContain(earlier.initiators, later.initiators)
  );
}

/** Empty means any initiator; otherwise every later initiator needs earlier cover. */
function initiatorsContain(
  earlier: readonly string[],
  later: readonly string[],
): boolean {
  if (earlier.length === 0) {
    return true;
  }
  return (
    later.length > 0 &&
    later.every((laterDomain) =>
      earlier.some((earlierDomain) =>
        domainContains(earlierDomain, laterDomain),
      ),
    )
  );
}

function resourceTypesContain(
  earlier: Rule["resourceTypes"],
  later: Rule["resourceTypes"],
): boolean {
  const earlierTypes = new Set(expandResourceTypes(earlier));
  return expandResourceTypes(later).every((resourceType) =>
    earlierTypes.has(resourceType),
  );
}

function scopeContains(earlier: Scope, later: Scope): boolean {
  if (earlier.type === "domains" && later.type === "domains") {
    return later.domains.every((laterDomain) =>
      earlier.domains.some((earlierDomain) =>
        domainContains(earlierDomain, laterDomain),
      ),
    );
  }
  if (earlier.type === "all") {
    return later.type === "domains" || later.type === "all";
  }
  if (earlier.type === "pattern" && later.type === "pattern") {
    return earlier.pattern === later.pattern;
  }
  if (earlier.type === "regex" && later.type === "regex") {
    return earlier.regex === later.regex;
  }
  return false;
}

function domainContains(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.endsWith(`.${parent}`);
}
