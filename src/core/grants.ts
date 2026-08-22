import type { Rule } from "./model";
import {
  anchorAdmits,
  anchoredOrigin,
  expandResourceTypes,
  hostUnder,
  originPatternForDomain,
  webOriginFromUrl,
} from "./scope";

export const ALL_SITES_ORIGIN = "*://*/*";

/**
 * The permissions the manifest declares, in the order it declares them. The
 * manifest is built from this list and the About page keys its disclosure rows
 * off it, so the two cannot drift: adding an entry here without a reason to
 * show beside it does not compile.
 */
export const MANIFEST_PERMISSIONS = [
  "declarativeNetRequestWithHostAccess",
  "storage",
  "activeTab",
] as const;

export type ManifestPermission = (typeof MANIFEST_PERMISSIONS)[number];

export function isAllSitesOrigin(origin: string): boolean {
  return origin === ALL_SITES_ORIGIN || origin === "<all_urls>";
}

export interface GrantSnapshot {
  readonly origins: readonly string[];
  readonly allSites: boolean;
}

export type GrantCoverage = "full" | "partial" | "none";

export function requiredOrigins(
  rule: Pick<Rule, "scope" | "resourceTypes" | "initiators">,
): string[] {
  // A pattern/regex rule names no host to grant. Without one Chrome applies
  // nothing unless all-sites is granted, so the honest requirement is broad
  // access — not the empty set, which would read as already-live (initiators
  // are moot once broad access is what's asked).
  if (
    (rule.scope.type === "pattern" || rule.scope.type === "regex") &&
    rule.scope.hosts.length === 0
  ) {
    return [ALL_SITES_ORIGIN];
  }

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
  return (
    grantedPatternCoverage(granted, originPatternForDomain(domain)) === "full"
  );
}

export function originCovered(origin: string, granted: GrantSnapshot): boolean {
  if (granted.allSites) {
    return true;
  }
  const required = webOriginFromUrl(origin);
  if (required === undefined || required.origin !== origin) {
    return false;
  }
  const target: OriginPattern = {
    scheme: required.scheme,
    host: required.host,
    includesSubdomains: false,
    port: required.port,
  };
  return granted.origins.some((grant) => {
    const pattern = parseOriginPattern(grant);
    return pattern !== undefined && patternContains(pattern, target);
  });
}

export interface GrantNarrowing {
  readonly host: string;
  readonly urlFilter?: string;
}

/**
 * Returns partial-grant narrowings for a domain. A concrete-scheme or ported
 * grant that includes subdomains is pinned to its apex host, so the subdomains
 * that grant also covers are not served by the projection.
 */
export function grantNarrowings(
  domain: string,
  granted: GrantSnapshot,
): GrantNarrowing[] {
  const required = originPatternForDomain(domain);
  const narrowings: GrantNarrowing[] = [];
  for (const origin of granted.origins) {
    const pattern = parseOriginPattern(origin);
    if (
      pattern !== undefined &&
      originPatternCoverage(origin, required) === "partial"
    ) {
      const host = hostUnder(pattern.host, domain) ? pattern.host : domain;
      if (
        pattern.scheme === "*" &&
        pattern.includesSubdomains &&
        pattern.port === undefined
      ) {
        narrowings.push({ host });
        continue;
      }
      for (const scheme of pattern.scheme === "*"
        ? ["http", "https"]
        : [pattern.scheme]) {
        const urlFilter = `|${scheme}://${host}${pattern.port === undefined ? "^" : `:${pattern.port}/`}`;
        narrowings.push({ host, urlFilter });
      }
    }
  }
  return dropCoveredNarrowings(narrowings);
}

export function dropCoveredNarrowings<T extends GrantNarrowing>(
  items: readonly T[],
): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = `${item.host}\u0000${item.urlFilter ?? ""}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }
  const collected = [...unique.values()];
  return collected.filter(
    (narrowing) =>
      !collected.some(
        (other) => other !== narrowing && narrowingCoveredBy(narrowing, other),
      ),
  );
}

function narrowingCoveredBy(
  narrowing: GrantNarrowing,
  other: GrantNarrowing,
): boolean {
  if (other.urlFilter === undefined) {
    return hostUnder(narrowing.host, other.host);
  }
  if (narrowing.urlFilter === undefined) {
    return false;
  }
  const narrowingAnchor = anchoredOrigin(narrowing.urlFilter);
  return (
    narrowingAnchor !== undefined &&
    anchorAdmits(other.urlFilter, narrowingAnchor.origin) === true
  );
}

export function missingGrants(rule: Rule, granted: GrantSnapshot): string[] {
  if (granted.allSites) {
    return [];
  }

  return requiredOrigins(rule).filter(
    (origin) => grantedPatternCoverage(granted, origin) !== "full",
  );
}

/**
 * Whether the rule reaches beyond navigations. Only then does the platform
 * require the initiating page granted too, so only then can an unnamed
 * initiator be a silent gap worth a standing note.
 */
export function coversSubresourceTypes(
  rule: Pick<Rule, "resourceTypes">,
): boolean {
  return expandResourceTypes(rule.resourceTypes).some(
    (resourceType) =>
      resourceType !== "main_frame" && resourceType !== "sub_frame",
  );
}

export function originPatternCoverage(
  granted: string,
  required: string,
): GrantCoverage {
  const grantedPattern = parseOriginPattern(granted);
  const requiredPattern = parseOriginPattern(required);
  if (grantedPattern === undefined || requiredPattern === undefined) {
    return "none";
  }

  if (!patternsIntersect(grantedPattern, requiredPattern)) {
    return "none";
  }
  return patternContains(grantedPattern, requiredPattern) ? "full" : "partial";
}

export function domainFromOriginPattern(pattern: string): string | undefined {
  return parseOriginPattern(pattern)?.host;
}

interface OriginPattern {
  readonly scheme: "*" | "http" | "https";
  readonly host: string;
  readonly includesSubdomains: boolean;
  /** Undefined means every port, as Chrome's containment oracle confirms. */
  readonly port: string | undefined;
}

// Chrome returns extension-requested patterns byte-identically, while its
// toolbar narrowing returns a concrete scheme, a bare host, and a non-default
// port when present. Keep all three axes: Chrome enforces them independently.
function parseOriginPattern(pattern: string): OriginPattern | undefined {
  const match =
    /^(\*|https?):\/\/(\*\.)?(\[[^\]]+\]|[^/:*]+)(?::(\d+))?\/\*$/.exec(
      pattern,
    );
  const scheme = match?.[1] as OriginPattern["scheme"] | undefined;
  const host = match?.[3];
  if (scheme === undefined || host === undefined) {
    return undefined;
  }
  return {
    scheme,
    host,
    includesSubdomains: match?.[2] !== undefined,
    port: match?.[4],
  };
}

function grantedPatternCoverage(
  granted: GrantSnapshot,
  required: string,
): GrantCoverage {
  if (granted.allSites) {
    return "full";
  }
  const requiredPattern = parseOriginPattern(required);
  if (requiredPattern === undefined) {
    return "none";
  }
  if (
    (["http", "https"] as const).every((scheme) =>
      granted.origins.some((origin) => {
        const pattern = parseOriginPattern(origin);
        return (
          pattern !== undefined &&
          (pattern.scheme === "*" || pattern.scheme === scheme) &&
          pattern.port === undefined &&
          hostContains(pattern, requiredPattern)
        );
      }),
    )
  ) {
    return "full";
  }
  return granted.origins.some((origin) => {
    const pattern = parseOriginPattern(origin);
    return pattern !== undefined && patternsIntersect(pattern, requiredPattern);
  })
    ? "partial"
    : "none";
}

function patternContains(
  granted: OriginPattern,
  required: OriginPattern,
): boolean {
  return (
    (granted.scheme === "*" || granted.scheme === required.scheme) &&
    (granted.port === undefined || granted.port === required.port) &&
    hostContains(granted, required)
  );
}

function hostContains(
  granted: OriginPattern,
  required: OriginPattern,
): boolean {
  return granted.includesSubdomains
    ? hostUnder(required.host, granted.host)
    : !required.includesSubdomains && granted.host === required.host;
}

function patternsIntersect(left: OriginPattern, right: OriginPattern): boolean {
  const schemesIntersect =
    left.scheme === "*" || right.scheme === "*" || left.scheme === right.scheme;
  const portsIntersect =
    left.port === undefined ||
    right.port === undefined ||
    left.port === right.port;
  const hostsIntersect =
    (left.includesSubdomains && hostUnder(right.host, left.host)) ||
    (right.includesSubdomains && hostUnder(left.host, right.host)) ||
    left.host === right.host;
  return schemesIntersect && portsIntersect && hostsIntersect;
}
