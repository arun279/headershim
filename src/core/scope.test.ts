import { describe, expect, it } from "vitest";
import type { ResourceGroup } from "./model";
import {
  DNR_RESOURCE_TYPES,
  expandResourceTypes,
  isDomainSupported,
  originPatternForDomain,
  RESOURCE_TYPES_BY_GROUP,
  scopeCondition,
  validateUrlFilter,
} from "./scope";

describe("resource type expansion", () => {
  it("expands all to the portable enum including top-level navigations", () => {
    const expanded = expandResourceTypes("all");

    expect(expanded).toEqual(DNR_RESOURCE_TYPES);
    expect(expanded).toContain("main_frame");
    // webtransport and webbundle are cross-browser DNR types (Chrome ~107,
    // Firefox supported), so the portable "all" expansion must cover them too.
    expect(expanded).toContain("webtransport");
    expect(expanded).toContain("webbundle");
  });

  it("maps every resource group and removes duplicate enum members", () => {
    const groups: ResourceGroup[] = [
      "pages",
      "subframes",
      "xhr",
      "scripts",
      "stylesheets",
      "images",
      "fonts",
      "media",
      "websockets",
      "other",
    ];

    expect(RESOURCE_TYPES_BY_GROUP.pages).toEqual(["main_frame"]);
    expect(RESOURCE_TYPES_BY_GROUP.subframes).toEqual(["sub_frame"]);
    expect(RESOURCE_TYPES_BY_GROUP.xhr).toEqual(["xmlhttprequest"]);
    expect(RESOURCE_TYPES_BY_GROUP.scripts).toEqual(["script"]);
    expect(RESOURCE_TYPES_BY_GROUP.stylesheets).toEqual(["stylesheet"]);
    expect(RESOURCE_TYPES_BY_GROUP.images).toEqual(["image"]);
    expect(RESOURCE_TYPES_BY_GROUP.fonts).toEqual(["font"]);
    expect(RESOURCE_TYPES_BY_GROUP.media).toEqual(["media"]);
    expect(RESOURCE_TYPES_BY_GROUP.websockets).toEqual(["websocket"]);
    expect(RESOURCE_TYPES_BY_GROUP.other).toEqual([
      "object",
      "ping",
      "csp_report",
      "webtransport",
      "webbundle",
      "other",
    ]);
    expect(new Set(expandResourceTypes(groups))).toEqual(
      new Set(DNR_RESOURCE_TYPES),
    );
    expect(expandResourceTypes(["other", "other"])).toEqual([
      "object",
      "ping",
      "csp_report",
      "webtransport",
      "webbundle",
      "other",
    ]);
    expect(expandResourceTypes([])).toEqual([]);
  });

  it("emits a multi-group subset in canonical DNR order, not UI-group order", () => {
    // xhr+scripts in UI order would be [xmlhttprequest, script]; the compiler
    // must emit DNR enum order so the reconcile round-trip compares equal to
    // whatever order Chrome echoes back (C1-1).
    expect(expandResourceTypes(["xhr", "scripts"])).toEqual([
      "script",
      "xmlhttprequest",
    ]);
    expect(expandResourceTypes(["media", "pages", "images"])).toEqual([
      "main_frame",
      "image",
      "media",
    ]);
  });
});

describe("scope conditions", () => {
  it("maps each scope to its URL condition fragment", () => {
    const domains = ["example.com", "api.example.net"];

    expect(scopeCondition({ type: "domains", domains })).toEqual({
      requestDomains: domains,
    });
    expect(
      scopeCondition({
        type: "pattern",
        pattern: "||example.com^",
        hosts: ["example.com"],
      }),
    ).toEqual({
      requestDomains: ["example.com"],
      urlFilter: "||example.com^",
    });
    expect(
      scopeCondition({
        type: "regex",
        regex: "^https://example\\.com/",
        hosts: ["example.com"],
      }),
    ).toEqual({
      requestDomains: ["example.com"],
      regexFilter: "^https://example\\.com/",
    });
    expect(
      scopeCondition({ type: "pattern", pattern: "/api", hosts: [] }),
    ).toEqual({ urlFilter: "/api" });
    expect(scopeCondition({ type: "all" })).toEqual({});
    expect(
      scopeCondition({ type: "domains", domains }).requestDomains,
    ).not.toBe(domains);
  });
});

describe("origin patterns", () => {
  it("covers a domain and all of its subdomains on both schemes", () => {
    expect(originPatternForDomain("api.example.com")).toBe(
      "*://*.api.example.com/*",
    );
  });

  it("uses exact-host patterns for IP literals", () => {
    expect(originPatternForDomain("127.0.0.1")).toBe("*://127.0.0.1/*");
    expect(originPatternForDomain("[::1]")).toBe("*://[::1]/*");
  });
});

describe("urlFilter grammar", () => {
  it.each([
    "||example.com^",
    "||example.com/",
    "||example.com/api/",
    "*://*/api/*",
    "|https://x/*|",
    "/path",
  ])("accepts the Chrome-legal filter %s", (pattern) => {
    expect(validateUrlFilter(pattern).ok).toBe(true);
  });

  it("rejects a non-ASCII filter (an unconverted IDN)", () => {
    const result = validateUrlFilter("||exämple.com^");
    expect(result).toEqual({ ok: false, error: "non-ascii" });
  });

  it("rejects a wildcard immediately after the domain anchor", () => {
    const result = validateUrlFilter("||*.example.com");
    expect(result).toEqual({ ok: false, error: "domain-anchor-wildcard" });
  });
});

describe("requestDomains grammar", () => {
  // Chrome refuses exactly one thing in a requestDomains entry, and takes the
  // rest verbatim however unlikely it is to ever match a request. The gate is
  // pinned to that, so it can never drop a rule Chrome would have run.
  it.each([
    ["example.com", "the ordinary case"],
    ["a.b.example.com", "sub-domains"],
    ["xn--bcher-kva.de", "an internationalized domain, as punycode"],
    ["localhost", "a single label"],
    ["1.2.3.4", "an IPv4"],
    ["[2001:db8::1]", "a bracketed IPv6"],
    ["EXAMPLE.com", "uppercase, which Chrome stores as given"],
    ["example.com:8080", "a port, which Chrome stores as given"],
    ["example.com/api", "a path, which Chrome stores as given"],
    ["*.example.com", "a wildcard, which Chrome stores as given"],
    ["example..com", "an empty label, which Chrome stores as given"],
    ["exa mple.com", "a space, which Chrome stores as given"],
  ])("accepts %s (%s)", (domain) => {
    expect(isDomainSupported(domain)).toBe(true);
  });

  it.each([
    ["ex\u00e4mple.com", "a non-ASCII character"],
    ["ex\u00a0ample.com", "a non-breaking space"],
    ["a\u{1f600}.com", "an astral character, which arrives as surrogates"],
  ])("rejects a domain carrying %s (%s)", (domain) => {
    expect(isDomainSupported(domain)).toBe(false);
  });

  it("draws the boundary at U+0080, exactly where Chrome draws it", () => {
    expect(isDomainSupported("a\u007f.com")).toBe(true);
    expect(isDomainSupported("a\u0080.com")).toBe(false);
  });
});
