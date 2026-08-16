import {
  coversSubresourceTypes,
  domainFromOriginPattern,
  type GrantSnapshot,
  isAllSitesOrigin,
  missingGrants,
  narrowedGrantUrlFilters,
  originGranted,
} from "../../core/grants";
import {
  activeProfile,
  type Rule,
  type StateDoc,
  type TabOverride,
} from "../../core/model";
import { expandResourceTypes, originPatternForDomain } from "../../core/scope";

export interface SiteAccessEntry {
  readonly coverage: "full" | "partial" | "none";
  readonly origin: string;
  readonly domain: string;
  readonly ruleCount: number;
  /** Enabled temporary changes using this origin, omitted when there are none. */
  readonly thisTabCount?: number;
  /** Concrete Chrome grants whose own host matches this row. */
  readonly grantedOrigins?: readonly string[];
  /** Every Chrome grant that supplies some coverage for this row. */
  readonly coveringOrigins?: readonly string[];
}

export interface SiteAccessView {
  readonly needed: readonly SiteAccessEntry[];
  readonly partial: readonly SiteAccessEntry[];
  readonly granted: readonly SiteAccessEntry[];
  readonly initiatorNote: boolean;
}

/**
 * One row per displayed domain, classified as full, partial, or missing. Chrome
 * can retain several origin strings for one domain, but exposing each string as
 * a separate row makes one site appear simultaneously granted and ungranted.
 * Partial counts describe changes that need broader access, not current usage.
 * Needed entries never include the broad origin — the all-sites card is its
 * only grant affordance, so broad access stays behind its honest framing.
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

  const grantedByDomain = new Map<string, string[]>();
  for (const origin of granted.origins) {
    if (isAllSitesOrigin(origin)) continue;
    const domain = domainFromOriginPattern(origin) ?? origin;
    const origins = grantedByDomain.get(domain) ?? [];
    origins.push(origin);
    grantedByDomain.set(domain, origins);
  }

  const neededEntries = [...needed]
    .map(([origin, usage]) => entry(origin, usage, "none"))
    .sort(byDomain);
  const partialDomains = new Set<string>();
  const partial = neededEntries.flatMap((neededEntry) => {
    const coveringOrigins = granted.origins.filter(
      (origin) =>
        narrowedGrantUrlFilters(neededEntry.domain, {
          origins: [origin],
          allSites: false,
        }).length !== 0,
    );
    if (coveringOrigins.length === 0) {
      return [];
    }
    const grantedOrigins = coveringOrigins.filter(
      (origin) => domainFromOriginPattern(origin) === neededEntry.domain,
    );
    partialDomains.add(neededEntry.domain);
    return [
      {
        ...neededEntry,
        coverage: "partial" as const,
        coveringOrigins,
        ...(grantedOrigins.length === 0 ? {} : { grantedOrigins }),
      },
    ];
  });

  return {
    needed: neededEntries.filter(
      (neededEntry) => !partialDomains.has(neededEntry.domain),
    ),
    partial,
    granted: [...grantedByDomain]
      .filter(
        ([domain]) =>
          !neededEntries.some((neededEntry) => neededEntry.domain === domain),
      )
      .map(([domain, origins]) => {
        const rowGrant = { origins, allSites: false };
        const ruleCount = activeProfile(doc)
          .rules.filter((rule) => rule.enabled)
          .filter((rule) => ruleUsesGrant(rule, rowGrant, granted)).length;
        const thisTabCount = overrides.filter(
          (override) =>
            override.enabled &&
            (originGranted(override.originHost, rowGrant) ||
              narrowedGrantUrlFilters(override.originHost, rowGrant).length !==
                0),
        ).length;
        return {
          ...entry(origins[0] ?? domain, { ruleCount, thisTabCount }, "full"),
          domain,
          grantedOrigins: origins,
        };
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

function entry(
  origin: string,
  usage: UsageCount,
  coverage: SiteAccessEntry["coverage"],
): SiteAccessEntry {
  return {
    coverage,
    origin,
    domain: domainFromOriginPattern(origin) ?? origin,
    ruleCount: usage.ruleCount,
    ...(usage.thisTabCount === 0 ? {} : { thisTabCount: usage.thisTabCount }),
  };
}

function initiatorsGranted(rule: Rule, granted: GrantSnapshot): boolean {
  return (
    !coversSubresourceTypes(rule) ||
    rule.initiators.every((initiator) => originGranted(initiator, granted))
  );
}

function ruleUsesGrant(
  rule: Rule,
  rowGrant: GrantSnapshot,
  granted: GrantSnapshot,
): boolean {
  if (!initiatorsGranted(rule, granted) || rule.scope.type === "all") {
    return false;
  }
  const hosts =
    rule.scope.type === "domains" ? rule.scope.domains : rule.scope.hosts;
  return hosts.some(
    (host) =>
      originGranted(host, rowGrant) ||
      (rule.scope.type === "domains" &&
        narrowedGrantUrlFilters(host, rowGrant).length !== 0),
  );
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
