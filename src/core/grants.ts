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

export function originPatternContains(
  granted: string,
  required: string,
): boolean {
  if (granted === required) {
    return true;
  }

  const grantedPattern = parseOriginPattern(granted);
  const requiredPattern = parseOriginPattern(required);
  if (
    grantedPattern === undefined ||
    requiredPattern === undefined ||
    !grantedPattern[1]
  ) {
    return false;
  }
  return hostUnder(requiredPattern[0], grantedPattern[0]);
}

export function domainFromOriginPattern(pattern: string): string | undefined {
  return parseOriginPattern(pattern)?.[0];
}

// The scheme is any of *, http, https: a rule's origins are always scheme-wild
// (`*://…`), but a grant the user narrowed through chrome://extensions is stored
// as the intersection of their pick and the manifest's `*://*/*`, which keeps
// their concrete scheme. Reading only `*://` would call such a grant missing and
// drop a rule the browser would run.
function parseOriginPattern(
  pattern: string,
): readonly [domain: string, includesSubdomains: boolean] | undefined {
  const match = /^(?:\*|https?):\/\/(\*\.)?([^/]+)\/\*$/.exec(pattern);
  const domain = match?.[2];
  if (domain === undefined || domain === "*") {
    return undefined;
  }
  return [domain, match?.[1] !== undefined];
}
