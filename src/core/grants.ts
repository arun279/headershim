import type { Rule } from "./model";
import { expandResourceTypes, originPatternForDomain } from "./scope";

export const ALL_SITES_ORIGIN = "*://*/*";

export interface GrantSnapshot {
  readonly origins: readonly string[];
  readonly allSites: boolean;
}

export function requiredOrigins(rule: Rule): string[] {
  const targets = (() => {
    switch (rule.scope.type) {
      case "domains":
        return rule.scope.domains.map(originPatternForDomain);
      case "pattern":
      case "regex":
        return rule.scope.hosts.map(originPatternForDomain);
      case "all":
        return [ALL_SITES_ORIGIN];
    }
  })();

  if (!hasSubresourceType(rule)) {
    return [...new Set(targets)];
  }

  return [
    ...new Set([...targets, ...rule.initiators.map(originPatternForDomain)]),
  ];
}

export function missingGrants(rule: Rule, granted: GrantSnapshot): string[] {
  if (granted.allSites) {
    return [];
  }

  return requiredOrigins(rule).filter(
    (origin) =>
      !granted.origins.some((grantedOrigin) =>
        originPatternContains(grantedOrigin, origin),
      ),
  );
}

function hasSubresourceType(rule: Rule): boolean {
  return expandResourceTypes(rule.resourceTypes).some(
    (resourceType) =>
      resourceType !== "main_frame" && resourceType !== "sub_frame",
  );
}

function originPatternContains(granted: string, required: string): boolean {
  if (granted === required) {
    return true;
  }

  const grantedDomain = domainFromOriginPattern(granted);
  const requiredDomain = domainFromOriginPattern(required);
  if (grantedDomain === undefined) {
    return false;
  }
  return requiredDomain?.endsWith(`.${grantedDomain}`) ?? false;
}

function domainFromOriginPattern(pattern: string): string | undefined {
  const match = /^\*:\/\/\*\.([^/]+)\/\*$/.exec(pattern);
  return match?.[1];
}
