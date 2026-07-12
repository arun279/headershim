import { normalizeHeaderName } from "./headers";
import type { Rule, Scope } from "./model";

export interface OverriddenRule {
  readonly ruleId: string;
  readonly shadowedByRuleId: string;
}

export function findOverriddenRules(rules: readonly Rule[]): OverriddenRule[] {
  const overridden: OverriddenRule[] = [];
  const earlierByHeader = new Map<string, Rule[]>();

  for (const rule of rules) {
    if (!rule.enabled || rule.operation === "append") {
      continue;
    }

    const header = normalizeHeaderName(rule.header);
    const earlierRules = earlierByHeader.get(header) ?? [];
    const shadowingRule = earlierRules.find(
      (candidate) =>
        candidate.direction === rule.direction &&
        scopeContains(candidate.scope, rule.scope),
    );
    if (shadowingRule !== undefined) {
      overridden.push({
        ruleId: rule.id,
        shadowedByRuleId: shadowingRule.id,
      });
    }
    earlierRules.push(rule);
    earlierByHeader.set(header, earlierRules);
  }

  return overridden;
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
