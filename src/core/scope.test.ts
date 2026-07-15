import { describe, expect, it } from "vitest";
import type { ResourceGroup } from "./model";
import {
  DNR_RESOURCE_TYPES,
  expandResourceTypes,
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
    ).toEqual({ urlFilter: "||example.com^" });
    expect(
      scopeCondition({
        type: "regex",
        regex: "^https://example\\.com/",
        hosts: ["example.com"],
      }),
    ).toEqual({ regexFilter: "^https://example\\.com/" });
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
