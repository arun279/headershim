import { describe, expect, it } from "vitest";
import { siteAccessView } from "../ui/state/site-access";
import {
  ALL_SITES_ORIGIN,
  domainFromOriginPattern,
  type GrantSnapshot,
  isAllSitesOrigin,
  missingGrants,
  originGrantCoverage,
  originGranted,
  originPatternCoverage,
  requiredOrigins,
} from "./grants";
import type { Profile, Rule, Scope, StateDoc } from "./model";
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
      originGrantCoverage("example.com", {
        origins: [observed],
        allSites: false,
      }),
    ).toBe("partial");
    expect(
      originGrantCoverage("www.example.com", {
        origins: [observed],
        allSites: false,
      }),
    ).toBe("none");
  });

  it("partly covers the host when Chrome stores a non-default port", () => {
    const observed = "http://localhost:55848/*";

    expect(
      originGrantCoverage("localhost", {
        origins: [observed],
        allSites: false,
      }),
    ).toBe("partial");
    expect(domainFromOriginPattern(observed)).toBe("localhost");
  });

  it("accepts an IP literal in extension-requested and browser-stored shapes", () => {
    expect(
      originGrantCoverage("127.0.0.1", {
        origins: ["*://127.0.0.1/*"],
        allSites: false,
      }),
    ).toBe("full");
    expect(
      originGrantCoverage("127.0.0.1", {
        origins: ["http://127.0.0.1:55848/*"],
        allSites: false,
      }),
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
      originGrantCoverage("example.com", {
        origins: ["*://example.com/*"],
        allSites: false,
      }),
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

    expect(originGrantCoverage("example.com", narrowed)).toBe("partial");
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
    expect(originGrantCoverage("api.example.com", toolbarNarrowed)).toBe(
      "partial",
    );
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

describe("siteAccessView", () => {
  const none: GrantSnapshot = { origins: [], allSites: false };

  function doc(profiles: Profile[]): StateDoc {
    return {
      v: 1,
      profiles,
      activeProfileId: profiles[0]?.id ?? "",
      nextRuleNum: 100,
      settings: { paused: false, theme: "system" },
    };
  }

  function profile(id: string, rules: Rule[]): Profile {
    return { id, name: id, badgeText: "PR", color: "blue", rules };
  }

  const enabledOverride = {
    num: 1,
    tabId: 5,
    originHost: "api.example.com",
    direction: "request",
    operation: "set",
    header: "x-session",
    value: "1",
    enabled: true,
  } as const;

  it("aggregates needed origins across rules, sorted by domain", () => {
    const subject = doc([
      profile("p1", [
        rule({ type: "domains", domains: ["zeta.example.com"] }, "all"),
        {
          ...rule({ type: "domains", domains: ["api.example.com"] }, "all"),
          id: "rule-2",
        },
        {
          ...rule(
            {
              type: "pattern",
              pattern: "||api.example.com^",
              hosts: ["api.example.com"],
            },
            "all",
          ),
          id: "rule-3",
        },
      ]),
    ]);

    expect(siteAccessView(subject, none).needed).toEqual([
      {
        coverage: "none",
        origin: originPatternForDomain("api.example.com"),
        domain: "api.example.com",
        ruleCount: 2,
      },
      {
        coverage: "none",
        origin: originPatternForDomain("zeta.example.com"),
        domain: "zeta.example.com",
        ruleCount: 1,
      },
    ]);
  });

  it("needs origins for enabled rules in the active profile only", () => {
    const subject = doc([
      profile("p1", [
        rule({ type: "domains", domains: ["api.example.com"] }, "all"),
        {
          ...rule({ type: "domains", domains: ["off.example.com"] }, "all"),
          id: "rule-2",
          enabled: false,
        },
      ]),
      profile("p2", [
        {
          ...rule({ type: "domains", domains: ["other.example.com"] }, "all"),
          id: "rule-3",
        },
      ]),
    ]);

    expect(siteAccessView(subject, none).needed).toEqual([
      {
        coverage: "none",
        origin: originPatternForDomain("api.example.com"),
        domain: "api.example.com",
        ruleCount: 1,
      },
    ]);
  });

  it("routes broad needs to the all-sites card, never a needed row", () => {
    const subject = doc([profile("p1", [rule({ type: "all" }, "all")])]);

    expect(siteAccessView(subject, none).needed).toEqual([]);
  });

  it("counts every rule that references a grant, enabled or not", () => {
    const granted = originPatternForDomain("api.example.com");
    const subject = doc([
      profile("p1", [
        { ...rule({ type: "domains", domains: ["api.example.com"] }, "all") },
        {
          ...rule({ type: "domains", domains: ["api.example.com"] }, "all"),
          id: "rule-2",
          enabled: false,
        },
      ]),
    ]);

    expect(
      siteAccessView(subject, { origins: [granted], allSites: false }).granted,
    ).toEqual([
      {
        coverage: "full",
        origin: granted,
        domain: "api.example.com",
        ruleCount: 2,
        grantedOrigins: [granted],
      },
    ]);
  });

  it("keeps a rule-less grant listed with a zero count", () => {
    const granted = originPatternForDomain("old.example.com");

    expect(
      siteAccessView(doc([profile("p1", [])]), {
        origins: [granted],
        allSites: false,
      }).granted,
    ).toEqual([
      {
        coverage: "full",
        origin: granted,
        domain: "old.example.com",
        ruleCount: 0,
        grantedOrigins: [granted],
      },
    ]);
  });

  it("counts enabled this-tab changes in granted and needed origins", () => {
    const origin = originPatternForDomain("api.example.com");
    const subject = doc([profile("p1", [])]);

    expect(siteAccessView(subject, none, [enabledOverride]).needed).toEqual([
      {
        coverage: "none",
        origin,
        domain: "api.example.com",
        ruleCount: 0,
        thisTabCount: 1,
      },
    ]);
    expect(
      siteAccessView(subject, { origins: [origin], allSites: false }, [
        enabledOverride,
        { ...enabledOverride, num: 2, enabled: false },
      ]).granted,
    ).toEqual([
      {
        coverage: "full",
        origin,
        domain: "api.example.com",
        ruleCount: 0,
        thisTabCount: 1,
        grantedOrigins: [origin],
      },
    ]);
  });

  it("keeps narrowed-grant rule and this-tab usage visible and actionable", () => {
    const observed = "https://api.example.com/*";
    const required = originPatternForDomain("api.example.com");
    const subject = doc([
      profile("p1", [
        rule({ type: "domains", domains: ["api.example.com"] }, "all"),
      ]),
    ]);

    expect(
      siteAccessView(subject, { origins: [observed], allSites: false }, [
        enabledOverride,
      ]),
    ).toMatchObject({
      needed: [],
      partial: [
        {
          coverage: "partial",
          origin: required,
          domain: "api.example.com",
          ruleCount: 1,
          thisTabCount: 1,
          grantedOrigins: [observed],
          limitedTo: observed,
        },
      ],
      granted: [],
    });
  });

  it("excludes the broad origin from the granted list", () => {
    expect(
      siteAccessView(doc([profile("p1", [])]), {
        origins: [ALL_SITES_ORIGIN, "<all_urls>"],
        allSites: true,
      }).granted,
    ).toEqual([]);
    expect(isAllSitesOrigin(ALL_SITES_ORIGIN)).toBe(true);
    expect(isAllSitesOrigin(originPatternForDomain("example.com"))).toBe(false);
  });

  it("raises the standing initiator note only for enabled subresource rules with no named initiator", () => {
    const bare = rule({ type: "domains", domains: ["api.example.com"] }, [
      "xhr",
    ]);

    expect(
      siteAccessView(doc([profile("p1", [bare])]), none).initiatorNote,
    ).toBe(true);
    expect(
      siteAccessView(
        doc([
          profile("p1", [
            { ...bare, initiators: ["app.example.com"] },
            { ...bare, id: "rule-2", resourceTypes: ["pages"] },
            { ...bare, id: "rule-3", enabled: false },
          ]),
          profile("p2", [{ ...bare, id: "rule-4" }]),
        ]),
        none,
      ).initiatorNote,
    ).toBe(false);
    expect(
      siteAccessView(doc([profile("p1", [bare])]), {
        origins: [ALL_SITES_ORIGIN],
        allSites: true,
      }).initiatorNote,
    ).toBe(false);
  });
});
