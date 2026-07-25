import type { Rule } from "./model";
import {
  expandResourceTypes,
  hostUnder,
  originPatternForDomain,
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
  return originGrantCoverage(domain, granted) === "full";
}

export function originGrantCoverage(
  domain: string,
  granted: GrantSnapshot,
): GrantCoverage {
  if (granted.allSites) {
    return "full";
  }
  const required = originPatternForDomain(domain);
  return combinedCoverage(
    granted.origins.map((origin) => originPatternCoverage(origin, required)),
  );
}

/**
 * The exact URL prefix Chrome's toolbar grant permits inside a wider
 * requestDomains condition. The observed toolbar shape is always a concrete
 * scheme and bare host, with an optional non-default port. Anchoring all three
 * axes lets the compiler keep that subset installed without activeTab widening
 * it to the rule's ungranted schemes, ports, or subdomains.
 */
export function narrowedGrantUrlFilter(
  domain: string,
  granted: GrantSnapshot,
): string | undefined {
  const required = originPatternForDomain(domain);
  for (const origin of granted.origins) {
    const pattern = parseOriginPattern(origin);
    if (
      pattern !== undefined &&
      pattern.scheme !== "*" &&
      !pattern.includesSubdomains &&
      originPatternCoverage(origin, required) === "partial"
    ) {
      return pattern.port === undefined
        ? `|${pattern.scheme}://${pattern.host}^`
        : `|${pattern.scheme}://${pattern.host}:${pattern.port}/`;
    }
  }
  return undefined;
}

export function missingGrants(rule: Rule, granted: GrantSnapshot): string[] {
  if (granted.allSites) {
    return [];
  }

  return requiredOrigins(rule).filter(
    (origin) =>
      combinedCoverage(
        granted.origins.map((grantedOrigin) =>
          originPatternCoverage(grantedOrigin, origin),
        ),
      ) !== "full",
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
    /^(\*|https?):\/\/(\*\.)?(\[[^\]]+\]|[^/:]+)(?::(\d+))?\/\*$/.exec(pattern);
  const scheme = match?.[1] as OriginPattern["scheme"] | undefined;
  const host = match?.[3];
  if (scheme === undefined || host === undefined || host === "*") {
    return undefined;
  }
  return {
    scheme,
    host,
    includesSubdomains: match?.[2] !== undefined,
    port: match?.[4],
  };
}

function combinedCoverage(coverages: readonly GrantCoverage[]): GrantCoverage {
  return coverages.includes("full")
    ? "full"
    : coverages.includes("partial")
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
    (granted.includesSubdomains
      ? hostUnder(required.host, granted.host)
      : !required.includesSubdomains && granted.host === required.host)
  );
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
