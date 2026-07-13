import type { Rule, StateDoc } from "./model";
import { expandResourceTypes, originPatternForDomain } from "./scope";

export const ALL_SITES_ORIGIN = "*://*/*";

export function isAllSitesOrigin(origin: string): boolean {
  return origin === ALL_SITES_ORIGIN || origin === "<all_urls>";
}

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

  if (!coversSubresourceTypes(rule)) {
    return [...new Set(targets)];
  }

  return [
    ...new Set([...targets, ...rule.initiators.map(originPatternForDomain)]),
  ];
}

export function originGranted(domain: string, granted: GrantSnapshot): boolean {
  if (granted.allSites) {
    return true;
  }
  const required = originPatternForDomain(domain);
  return granted.origins.some((origin) =>
    originPatternContains(origin, required),
  );
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

export interface RuleGrantGap {
  readonly profileId: string;
  readonly ruleId: string;
  readonly missing: readonly string[];
}

export function docMissingGrants(
  doc: StateDoc,
  granted: GrantSnapshot,
): RuleGrantGap[] {
  return doc.profiles.flatMap((profile) =>
    profile.enabled
      ? profile.rules.flatMap((rule) => {
          const missing = rule.enabled ? missingGrants(rule, granted) : [];
          return missing.length === 0
            ? []
            : [{ profileId: profile.id, ruleId: rule.id, missing }];
        })
      : [],
  );
}

export interface SiteAccessEntry {
  readonly origin: string;
  readonly domain: string;
  readonly ruleCount: number;
}

export interface SiteAccessView {
  readonly needed: readonly SiteAccessEntry[];
  readonly granted: readonly SiteAccessEntry[];
  readonly initiatorNote: boolean;
}

/**
 * The Site access page's world: origins enabled rules still need, origins
 * already granted with the rules that reference them (pattern and regex rules
 * count through their persisted hosts, via requiredOrigins), and whether the
 * standing initiator note applies. Needed entries never include the broad
 * origin — the all-sites card is its only grant affordance, so broad access
 * stays behind its honest framing. Granted counts span all rules regardless of
 * enabled state, because grants outlive the rules that asked for them.
 */
export function siteAccessView(
  doc: StateDoc,
  granted: GrantSnapshot,
): SiteAccessView {
  const needed = new Map<string, number>();
  for (const gap of docMissingGrants(doc, granted)) {
    for (const origin of gap.missing) {
      if (!isAllSitesOrigin(origin)) {
        needed.set(origin, (needed.get(origin) ?? 0) + 1);
      }
    }
  }

  const required = doc.profiles.flatMap((profile) =>
    profile.rules.map(requiredOrigins),
  );
  return {
    needed: [...needed]
      .map(([origin, ruleCount]) => entry(origin, ruleCount))
      .sort(byDomain),
    granted: granted.origins
      .filter((origin) => !isAllSitesOrigin(origin))
      .map((origin) =>
        entry(
          origin,
          required.filter((origins) =>
            origins.some((candidate) =>
              originPatternContains(origin, candidate),
            ),
          ).length,
        ),
      )
      .sort(byDomain),
    initiatorNote:
      !granted.allSites &&
      doc.profiles.some(
        (profile) =>
          profile.enabled &&
          profile.rules.some(
            (rule) =>
              rule.enabled &&
              rule.initiators.length === 0 &&
              rule.scope.type !== "all" &&
              coversSubresourceTypes(rule),
          ),
      ),
  };
}

function entry(origin: string, ruleCount: number): SiteAccessEntry {
  return {
    origin,
    domain: domainFromOriginPattern(origin) ?? origin,
    ruleCount,
  };
}

function byDomain(a: SiteAccessEntry, b: SiteAccessEntry): number {
  return a.domain.localeCompare(b.domain);
}

/**
 * Whether the rule reaches beyond navigations. Only then does the platform
 * require the initiating page granted too, so only then can an unnamed
 * initiator be a silent gap worth a standing note.
 */
export function coversSubresourceTypes(rule: Rule): boolean {
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

export function domainFromOriginPattern(pattern: string): string | undefined {
  const match = /^\*:\/\/\*\.([^/]+)\/\*$/.exec(pattern);
  return match?.[1];
}
