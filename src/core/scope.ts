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

export function anchoredOrigin(
  filter: string,
): { origin: string; anyPort: boolean } | undefined {
  const match = /^\|(https?):\/\/(\[[^\]]+\]|[^/^:*]+)(?::(\d+))?([/^])$/.exec(
    filter,
  );
  if (match === null) {
    return undefined;
  }
  const [, scheme, host, port, terminator] = match;
  return {
    origin: `${scheme}://${host}${port === undefined ? "" : `:${port}`}`,
    anyPort: terminator === "^" && port === undefined,
  };
}

export function anchorAdmits(
  filter: string,
  origin: string,
): boolean | undefined {
  const anchor = anchoredOrigin(filter);
  if (anchor === undefined) {
    return undefined;
  }
  return (
    anchor.origin === origin ||
    (anchor.anyPort && origin.startsWith(`${anchor.origin}:`))
  );
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
      return {
        ...(scope.hosts.length === 0
          ? {}
          : { requestDomains: [...scope.hosts] }),
        urlFilter: scope.pattern,
      };
    case "regex":
      return {
        ...(scope.hosts.length === 0
          ? {}
          : { requestDomains: [...scope.hosts] }),
        regexFilter: scope.regex,
      };
    case "all":
      return {};
  }
}

/** Whether a host is the domain itself or one of its subdomains. */
export function hostUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function originPatternForDomain(domain: string): string {
  return isIpLiteral(domain) ? `*://${domain}/*` : `*://*.${domain}/*`;
}

// Chrome refuses a non-ASCII urlFilter or requestDomains entry outright, naming
// the offending key and failing the update. Any code unit at or above U+0080 is
// non-ASCII (astral chars surface as surrogates, also >= U+0080), so this flags
// exactly the > 0x7f case.
const NON_ASCII = /[\u0080-\uffff]/;

export function isRegexFilterSupported(regex: string): boolean {
  return !NON_ASCII.test(regex);
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
  if (NON_ASCII.test(pattern)) {
    return err("non-ascii");
  }
  if (pattern.startsWith("||*")) {
    return err("domain-anchor-wildcard");
  }
  return ok(undefined);
}

// A urlFilter that does not open with a pipe anchor is matched as a substring of
// the whole URL, query string included, so it can reach a host it never names.
// Chrome runs it exactly as written, so this is an author-time caution, not a
// gate; the empty field is the unwritten scope, not a leak.
export function isUnanchoredPattern(pattern: string): boolean {
  return pattern !== "" && !pattern.startsWith("|");
}

// requestDomains carries the same atomic-batch hazard as urlFilter, so gate it
// at the same two points: one entry Chrome refuses fails the whole update and
// freezes the live ruleset at its last-good revision.
//
// Chrome refuses exactly one thing in an entry — a non-ASCII character — and
// takes everything else verbatim. An uppercase, ported, pathed or wildcarded
// entry is stored unchanged and simply never matches a request, so this gate
// stays as narrow as Chrome's: anything stricter would drop a rule Chrome would
// have run, which is the same lie pointed the other way. The empty list Chrome
// also refuses is a property of the list rather than an entry, and is checked
// where the list is.
export function isDomainSupported(domain: string): boolean {
  return !NON_ASCII.test(domain);
}

// A host label: letters, digits, underscores and hyphens, never leading or
// trailing with a hyphen and never empty. An underscore is not an RFC 1123 DNS
// character, but GURL keeps it in a host and Chrome matches a request to it
// verbatim, so `my_service.corp` and `_dmarc.example.com` are live hosts, not
// the dead shapes this flags.
const HOSTNAME_LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i;
// A bracketed IPv6 literal: hex, colons and the dots an IPv4-mapped tail carries,
// with at least one colon so an IPv4 or a lone label is not mistaken for one.
// This is shape, not full RFC 4291 grammar; pathological colon runs still pass.
const IPV6_LITERAL = /^\[[0-9a-f:.]*:[0-9a-f:.]*\]$/i;

// Author-time host shape, and deliberately not the compiler gate above.
// isDomainSupported has to stay exactly as narrow as Chrome so it never drops a
// rule Chrome would run; this is feedback while a rule is being written, so it
// can name the shapes Chrome stores verbatim and then never matches: wildcards,
// ports, paths, schemes, stray dots, and dotted-decimal that is not a canonical
// IPv4. A host is an IPv6 literal, a canonical IPv4, or dot-separated host labels.
export function isHostnameShaped(host: string): boolean {
  if (IPV6_LITERAL.test(host)) {
    return true;
  }
  const labels = host.split(".");
  return labels.every((label) => /^\d+$/.test(label))
    ? isCanonicalIpv4(labels)
    : labels.every((label) => HOSTNAME_LABEL.test(label));
}

// Four octets Chrome would not rewrite: 0 to 255, and written the one way the
// canonical host is (so a leading zero or an out-of-range octet is not a host).
function isCanonicalIpv4(octets: string[]): boolean {
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => Number(octet) <= 255 && String(Number(octet)) === octet,
    )
  );
}

function isIpLiteral(domain: string): boolean {
  if (domain.startsWith("[") && domain.endsWith("]")) {
    return true;
  }
  const segments = domain.split(".");
  return (
    segments.length === 4 &&
    segments.every(
      (segment) =>
        /^\d{1,3}$/.test(segment) && Number.parseInt(segment, 10) <= 255,
    )
  );
}
