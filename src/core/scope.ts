import type { ResourceGroup, Rule, Scope } from "./model";
import { err, ok, type Result } from "./result";

export const DNR_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
] as const;

export type DnrResourceType = (typeof DNR_RESOURCE_TYPES)[number];

export const RESOURCE_TYPES_BY_GROUP = {
  pages: ["main_frame"],
  subframes: ["sub_frame"],
  xhr: ["xmlhttprequest"],
  scripts: ["script"],
  stylesheets: ["stylesheet"],
  images: ["image"],
  fonts: ["font"],
  media: ["media"],
  websockets: ["websocket"],
  other: ["object", "ping", "csp_report", "webtransport", "webbundle", "other"],
} as const satisfies Readonly<
  Record<ResourceGroup, readonly DnrResourceType[]>
>;

export interface ScopeCondition {
  readonly requestDomains?: string[];
  readonly urlFilter?: string;
  readonly regexFilter?: string;
}

export function expandResourceTypes(
  resourceTypes: Rule["resourceTypes"],
): DnrResourceType[] {
  if (resourceTypes === "all") {
    return [...DNR_RESOURCE_TYPES];
  }
  // Emit in canonical DNR enum order so the reconcile round-trip compares equal
  // to whatever order Chrome echoes back, independent of UI group order.
  const selected = new Set(
    resourceTypes.flatMap((group) => RESOURCE_TYPES_BY_GROUP[group]),
  );
  return DNR_RESOURCE_TYPES.filter((type) => selected.has(type));
}

export function scopeCondition(scope: Scope): ScopeCondition {
  switch (scope.type) {
    case "domains":
      return { requestDomains: [...scope.domains] };
    case "pattern":
      return { urlFilter: scope.pattern };
    case "regex":
      return { regexFilter: scope.regex };
    case "all":
      return {};
  }
}

export function originPatternForDomain(domain: string): string {
  return `*://*.${domain}/*`;
}

export type UrlFilterError = "non-ascii" | "domain-anchor-wildcard";

// A non-empty urlFilter that breaks Chrome's grammar is not rejected per-rule —
// updateDynamicRules fails the whole atomic batch, freezing the live ruleset at
// the last-good revision. Gate the two forms Chrome refuses (a non-ASCII filter,
// and a domain anchor immediately followed by a wildcard) at save and enable so
// one bad pattern can never take the batch down.
export function validateUrlFilter(
  pattern: string,
): Result<void, UrlFilterError> {
  // Any code unit at or above U+0080 is non-ASCII (astral chars surface as
  // surrogates, also >= U+0080), so this flags exactly the > 0x7f case.
  if (/[\u0080-\uffff]/.test(pattern)) {
    return err("non-ascii");
  }
  if (pattern.startsWith("||*")) {
    return err("domain-anchor-wildcard");
  }
  return ok(undefined);
}
