import { describe, expect, it } from "vitest";
import {
  ALL_SITES_ORIGIN,
  domainFromOriginPattern,
  type GrantSnapshot,
  grantNarrowings,
  missingGrants,
  originGranted,
  originPatternCoverage,
  requiredOrigins,
} from "./grants";
import type { Rule, Scope } from "./model";
import { originPatternForDomain } from "./scope";

function rule(
  scope: Scope,
  resourceTypes: Rule["resourceTypes"],
  initiators: string[] = [],
): Rule {
  return {
    id: "rule-1",
    num: 1,
    direction: "request",
    operation: "set",
    header: "x-debug",
    value: "on",
    scope,
    resourceTypes,
    initiators,
    enabled: true,
  };
}

describe("origin patterns", () => {
  it("keeps matching the exact shape returned from the extension's own prompt", () => {
    expect(
      originPatternCoverage(
        "*://*.example.test/*",
        originPatternForDomain("example.test"),
      ),
    ).toBe("full");
  });

  it("partly covers exactly the bare host Chrome stores for toolbar access", () => {
    const observed = "https://example.com/*";

    expect(
      originPatternCoverage(observed, originPatternForDomain("example.com")),
    ).toBe("partial");
    expect(
      originPatternCoverage(
        observed,
        originPatternForDomain("www.example.com"),
      ),
    ).toBe("none");
  });

  it("partly covers the host when Chrome stores a non-default port", () => {
    const observed = "http://localhost:55848/*";

    expect(
      originPatternCoverage(observed, originPatternForDomain("localhost")),
    ).toBe("partial");
    expect(domainFromOriginPattern(observed)).toBe("localhost");
  });

  it("accepts an IP literal in extension-requested and browser-stored shapes", () => {
    expect(
      originPatternCoverage(
        "*://127.0.0.1/*",
        originPatternForDomain("127.0.0.1"),
      ),
    ).toBe("full");
    expect(
      originPatternCoverage(
        "http://127.0.0.1:55848/*",
        originPatternForDomain("127.0.0.1"),
      ),
    ).toBe("partial");
  });

  it.each(["127.0.0.1", "[::1]"])(
    "round-trips an exact IP host: %s",
    (domain) => {
      const origin = originPatternForDomain(domain);

      expect(domainFromOriginPattern(origin)).toBe(domain);
      expect(
        originGranted(domain, { origins: [origin], allSites: false }),
      ).toBe(true);
    },
  );

  it("does not treat an exact-host grant as a parent-domain grant", () => {
    expect(
      originGranted("api.example.com", {
        origins: ["*://example.com/*"],
        allSites: false,
      }),
    ).toBe(false);
  });

  it("does not treat a bare-host grant as full coverage of its subdomains", () => {
    expect(
      originPatternCoverage(
        "*://example.com/*",
        originPatternForDomain("example.com"),
      ),
    ).toBe("partial");
  });

  it("distinguishes partial reach from full coverage for a wider rule", () => {
    const subject = rule({ type: "domains", domains: ["example.com"] }, [
      "pages",
    ]);
    const narrowed = {
      origins: ["https://example.com/*"],
      allSites: false,
    } as const;

    expect(
      originPatternCoverage(
        narrowed.origins[0],
        originPatternForDomain("example.com"),
      ),
    ).toBe("partial");
    expect(missingGrants(subject, narrowed)).toEqual([
      originPatternForDomain("example.com"),
    ]);
  });

  it("isolates scheme and port containment for an exact IP host", () => {
    const required = originPatternForDomain("127.0.0.1");

    expect(originPatternCoverage("http://127.0.0.1/*", required)).toBe(
      "partial",
    );
    expect(originPatternCoverage("*://127.0.0.1:55848/*", required)).toBe(
      "partial",
    );
  });

  it("intersects nested subdomain wildcards in either order", () => {
    expect(
      originPatternCoverage("*://*.sub.example.com/*", "*://*.example.com/*"),
    ).toBe("partial");
  });

  it("keeps scheme and port disjoint when Chrome would not apply the rule", () => {
    expect(
      originPatternCoverage("http://localhost/*", "https://localhost/*"),
    ).toBe("none");
    expect(
      originPatternCoverage(
        "http://localhost:55848/*",
        "http://localhost:58991/*",
      ),
    ).toBe("none");
  });

  it("rejects an invalid origin pattern", () => {
    expect(
      originPatternCoverage("https://example.com/*", "not an origin pattern"),
    ).toBe("none");
    expect(
      originGranted("example.com", {
        origins: ["not an origin pattern"],
        allSites: false,
      }),
    ).toBe(false);
  });

  it("keeps every stored grant that intersects a wider parent rule", () => {
    expect(
      grantNarrowings("example.com", {
        origins: [
          "https://a.example.com/*",
          "https://b.example.com/*",
          "https://a.example.com/*",
        ],
        allSites: false,
      }),
    ).toEqual([
      { host: "a.example.com", urlFilter: "|https://a.example.com^" },
      { host: "b.example.com", urlFilter: "|https://b.example.com^" },
    ]);
  });

  it("preserves safe wider wildcard and subdomain grant shapes", () => {
    expect(
      grantNarrowings("example.com", {
        origins: ["*://example.com/*", "https://*.sub.example.com/*"],
        allSites: false,
      }),
    ).toEqual([
      { host: "example.com", urlFilter: "|http://example.com^" },
      { host: "example.com", urlFilter: "|https://example.com^" },
      { host: "sub.example.com", urlFilter: "|https://sub.example.com^" },
    ]);
  });

  it("keeps an exact-host grant partial for a domain and its subdomains", () => {
    const granted = { origins: ["*://example.com/*"], allSites: false };

    expect(originGranted("example.com", granted)).toBe(false);
    expect(grantNarrowings("example.com", granted)).toEqual([
      { host: "example.com", urlFilter: "|http://example.com^" },
      { host: "example.com", urlFilter: "|https://example.com^" },
    ]);
  });

  it("drops port-specific localhost narrowing covered by a portless anchor", () => {
    expect(
      grantNarrowings("localhost", {
        origins: ["http://localhost/*", "http://localhost:15848/*"],
        allSites: false,
      }),
    ).toEqual([{ host: "localhost", urlFilter: "|http://localhost^" }]);
  });

  it("never emits a wildcard in any parsed grant narrowing", () => {
    const schemes = ["*", "http", "https"] as const;
    const subdomains = [false, true];
    const ports = [undefined, "8443"] as const;

    for (const scheme of schemes) {
      for (const includesSubdomains of subdomains) {
        for (const port of ports) {
          const origin = `${scheme}://${includesSubdomains ? "*." : ""}example.com${port === undefined ? "" : `:${port}`}/*`;
          const narrowings = grantNarrowings("example.com", {
            origins: [origin],
            allSites: false,
          });
          if (
            !originGranted("example.com", {
              origins: [origin],
              allSites: false,
            })
          ) {
            expect(narrowings).not.toEqual([]);
          }
          expect(
            narrowings.every(({ urlFilter }) => !urlFilter?.includes("*")),
          ).toBe(true);
        }
      }
    }
  });

  it("ignores an unsupported wildcard host pattern", () => {
    expect(
      grantNarrowings("example.com", {
        origins: ["https://*foo.example.com/*"],
        allSites: false,
      }),
    ).toEqual([]);
  });
});

describe("requiredOrigins", () => {
  it("does not contribute initiators for a Pages-only rule", () => {
    expect(
      requiredOrigins(
        rule(
          { type: "domains", domains: ["api.example.com"] },
          ["pages"],
          ["app.example.com"],
        ),
      ),
    ).toEqual([originPatternForDomain("api.example.com")]);
  });

  it("contributes initiators for a subresource-only rule", () => {
    expect(
      requiredOrigins(
        rule(
          { type: "domains", domains: ["api.example.com"] },
          ["xhr"],
          ["app.example.com"],
        ),
      ),
    ).toEqual([
      originPatternForDomain("api.example.com"),
      originPatternForDomain("app.example.com"),
    ]);
  });

  it("contributes initiators when a mixed rule has a subresource type", () => {
    expect(
      requiredOrigins(
        rule(
          { type: "domains", domains: ["api.example.com"] },
          ["pages", "subframes", "scripts"],
          ["app.example.com"],
        ),
      ),
    ).toEqual([
      originPatternForDomain("api.example.com"),
      originPatternForDomain("app.example.com"),
    ]);
  });

  it("routes all-sites scopes through the broad origin grant", () => {
    expect(requiredOrigins(rule({ type: "all" }, ["pages"]))).toEqual([
      ALL_SITES_ORIGIN,
    ]);
  });

  it.each<Scope>([
    { type: "pattern", pattern: "||example.com^", hosts: [] },
    { type: "regex", regex: "^https://x/", hosts: [] },
  ])(
    "requires broad access for a %s rule that names no host (Chrome applies nothing without a grant)",
    (scope) => {
      expect(
        requiredOrigins(rule(scope, ["xhr"], ["app.example.com"])),
      ).toEqual([ALL_SITES_ORIGIN]);
    },
  );

  it("deduplicates target and initiator origin patterns", () => {
    expect(
      requiredOrigins(
        rule(
          {
            type: "domains",
            domains: ["example.com", "example.com"],
          },
          ["xhr"],
          ["example.com"],
        ),
      ),
    ).toEqual([originPatternForDomain("example.com")]);
  });
});

describe("missingGrants", () => {
  const none: GrantSnapshot = { origins: [], allSites: false };

  it.each<Scope>([
    { type: "pattern", pattern: "||example.com^", hosts: [] },
    { type: "regex", regex: "^https://x/", hosts: [] },
  ])(
    "reports broad access for an ungranted $type rule with no named sites",
    (scope) => {
      expect(missingGrants(rule(scope, "all"), none)).toEqual([
        ALL_SITES_ORIGIN,
      ]);
    },
  );

  it("reports an ungranted domain target", () => {
    expect(
      missingGrants(
        rule({ type: "domains", domains: ["api.example.com"] }, ["pages"]),
        none,
      ),
    ).toEqual([originPatternForDomain("api.example.com")]);
  });

  it("reports a named initiator that is not granted", () => {
    const target = originPatternForDomain("api.example.com");

    expect(
      missingGrants(
        rule(
          { type: "domains", domains: ["api.example.com"] },
          ["xhr"],
          ["app.example.com"],
        ),
        { origins: [target], allSites: false },
      ),
    ).toEqual([originPatternForDomain("app.example.com")]);
  });

  it("clears the initiator gap when destination-only access gains the initiator grant", () => {
    const target = originPatternForDomain("api.example.com");
    const initiator = originPatternForDomain("app.example.com");
    const subject = rule(
      { type: "domains", domains: ["api.example.com"] },
      ["xhr"],
      ["app.example.com"],
    );

    expect(
      missingGrants(subject, { origins: [target], allSites: false }),
    ).toEqual([initiator]);
    expect(
      missingGrants(subject, {
        origins: [target, initiator],
        allSites: false,
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "subdomain grants split across schemes",
      "example.com",
      ["http://*.example.com/*", "https://*.example.com/*"],
    ],
    [
      "IP grants split across schemes",
      "127.0.0.1",
      ["http://127.0.0.1/*", "https://127.0.0.1/*"],
    ],
  ])("joins %s", (_, domain, origins) => {
    const subject = rule({ type: "domains", domains: [domain] }, ["pages"]);
    const granted = { origins, allSites: false };

    expect(originGranted(domain, granted)).toBe(true);
    expect(missingGrants(subject, granted)).toEqual([]);
  });

  it("keeps a single concrete-scheme subdomain grant partial", () => {
    const subject = rule({ type: "domains", domains: ["example.com"] }, [
      "pages",
    ]);
    const granted = { origins: ["https://*.example.com/*"], allSites: false };

    expect(
      originPatternCoverage(
        "https://*.example.com/*",
        originPatternForDomain("example.com"),
      ),
    ).toBe("partial");
    expect(originGranted("example.com", granted)).toBe(false);
    expect(missingGrants(subject, granted)).toEqual([
      originPatternForDomain("example.com"),
    ]);
  });

  it("accepts a parent-domain grant for a required subdomain", () => {
    const subject = rule({ type: "domains", domains: ["api.example.com"] }, [
      "pages",
    ]);

    expect(
      missingGrants(subject, {
        origins: [originPatternForDomain("example.com")],
        allSites: false,
      }),
    ).toEqual([]);
    // Chrome's toolbar site-access control stores a concrete scheme and the
    // bare host. That observed exact-origin grant only partially covers the
    // wider subdomain requirement and therefore still needs widening.
    const toolbarNarrowed = {
      origins: ["https://api.example.com/*"],
      allSites: false,
    } as const;
    expect(
      originPatternCoverage(
        toolbarNarrowed.origins[0],
        originPatternForDomain("api.example.com"),
      ),
    ).toBe("partial");
    expect(missingGrants(subject, toolbarNarrowed)).toEqual([
      originPatternForDomain("api.example.com"),
    ]);
  });

  it("treats all-sites access as satisfying targets and initiators", () => {
    expect(
      missingGrants(
        rule(
          { type: "domains", domains: ["api.example.com"] },
          ["xhr"],
          ["app.example.com"],
        ),
        { origins: [], allSites: true },
      ),
    ).toEqual([]);
  });

  it("uses persisted pattern and regex hosts with their initiators", () => {
    const initiator = originPatternForDomain("app.example.com");

    expect(
      missingGrants(
        rule(
          {
            type: "pattern",
            pattern: "||api.example.com^",
            hosts: ["api.example.com"],
          },
          ["xhr"],
          ["app.example.com"],
        ),
        none,
      ),
    ).toEqual([originPatternForDomain("api.example.com"), initiator]);
    expect(
      missingGrants(
        rule(
          {
            type: "regex",
            regex: "^https://service\\.example\\.net/",
            hosts: ["service.example.net"],
          },
          ["scripts"],
          ["app.example.com"],
        ),
        none,
      ),
    ).toEqual([originPatternForDomain("service.example.net"), initiator]);
  });

  it("recomputes missing origins after a grant is revoked", () => {
    const subject = rule(
      { type: "domains", domains: ["api.example.com"] },
      ["xhr"],
      ["app.example.com"],
    );
    const required = requiredOrigins(subject);

    expect(missingGrants(subject, none)).toEqual(required);
    expect(
      missingGrants(subject, { origins: required, allSites: false }),
    ).toEqual([]);
    expect(
      missingGrants(subject, {
        origins: required.slice(0, -1),
        allSites: false,
      }),
    ).toEqual([originPatternForDomain("app.example.com")]);
  });
});
