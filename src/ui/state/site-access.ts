import {
  domainFromOriginPattern,
  type GrantSnapshot,
  isAllSitesOrigin,
  missingGrants,
  originGranted,
  originPatternContains,
  requiredOrigins,
} from "../../core/grants";
import {
  activeProfile,
  type Rule,
  type StateDoc,
  type TabOverride,
} from "../../core/model";
import { expandResourceTypes, originPatternForDomain } from "../../core/scope";

export interface SiteAccessEntry {
  readonly origin: string;
  readonly domain: string;
  readonly ruleCount: number;
  /** Enabled temporary changes using this origin, omitted when there are none. */
  readonly thisTabCount?: number;
}

export interface SiteAccessView {
  readonly needed: readonly SiteAccessEntry[];
  readonly granted: readonly SiteAccessEntry[];
  readonly initiatorNote: boolean;
}

/**
 * The Site access page's world: origins enabled saved or temporary changes
 * still need, origins already granted with the changes that reference them,
 * and whether the standing initiator note applies. Pattern and regex rules
 * count through their persisted hosts, via requiredOrigins. Needed entries
 * never include the broad origin — the all-sites card is its only grant
 * affordance, so broad access stays behind its honest framing. Granted rule
 * counts span all saved rules because grants outlive them; temporary counts
 * include enabled session rows that are using the grant now.
 */
export function siteAccessView(
  doc: StateDoc,
  granted: GrantSnapshot,
  overrides: readonly TabOverride[] = [],
): SiteAccessView {
  const needed = new Map<string, UsageCount>();
  for (const rule of activeProfile(doc).rules) {
    if (!rule.enabled) continue;
    for (const origin of missingGrants(rule, granted)) {
      if (!isAllSitesOrigin(origin)) {
        incrementUsage(needed, origin, "ruleCount");
      }
    }
  }
  for (const override of overrides) {
    if (!override.enabled || originGranted(override.originHost, granted)) {
      continue;
    }
    incrementUsage(
      needed,
      originPatternForDomain(override.originHost),
      "thisTabCount",
    );
  }

  const required = doc.profiles.flatMap((profile) =>
    profile.rules.map(requiredOrigins),
  );
  return {
    needed: [...needed]
      .map(([origin, usage]) => entry(origin, usage))
      .sort(byDomain),
    granted: granted.origins
      .filter((origin) => !isAllSitesOrigin(origin))
      .map((origin) => {
        const ruleCount = required.filter((origins) =>
          origins.some((candidate) => originPatternContains(origin, candidate)),
        ).length;
        const thisTabCount = overrides.filter(
          (override) =>
            override.enabled &&
            originPatternContains(
              origin,
              originPatternForDomain(override.originHost),
            ),
        ).length;
        return entry(origin, { ruleCount, thisTabCount });
      })
      .sort(byDomain),
    initiatorNote:
      !granted.allSites &&
      activeProfile(doc).rules.some(
        (rule) =>
          rule.enabled &&
          rule.initiators.length === 0 &&
          rule.scope.type !== "all" &&
          subresourceScopedRule(rule),
      ),
  };
}

interface UsageCount {
  readonly ruleCount: number;
  readonly thisTabCount: number;
}

function incrementUsage(
  usage: Map<string, UsageCount>,
  origin: string,
  field: keyof UsageCount,
): void {
  const current = usage.get(origin) ?? { ruleCount: 0, thisTabCount: 0 };
  usage.set(origin, { ...current, [field]: current[field] + 1 });
}

function entry(origin: string, usage: UsageCount): SiteAccessEntry {
  return {
    origin,
    domain: domainFromOriginPattern(origin) ?? origin,
    ruleCount: usage.ruleCount,
    ...(usage.thisTabCount === 0 ? {} : { thisTabCount: usage.thisTabCount }),
  };
}

function byDomain(a: SiteAccessEntry, b: SiteAccessEntry): number {
  return a.domain.localeCompare(b.domain);
}

/**
 * When the standing initiator note is worth showing on a healthy rule:
 * the rule reaches subresources but NOT top-level page navigations, so its
 * requests are genuinely started by some *other* page and that page needs
 * granting too. A default all-types rule includes main_frame — the common
 * direct-navigation case the user is not surprised by — so it stays quiet.
 */
function subresourceScopedRule(rule: Rule): boolean {
  const expanded = expandResourceTypes(rule.resourceTypes);
  return (
    !expanded.includes("main_frame") &&
    expanded.some((type) => type !== "main_frame" && type !== "sub_frame")
  );
}
