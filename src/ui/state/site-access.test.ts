import { describe, expect, it } from "vitest";
import {
  ALL_SITES_ORIGIN,
  type GrantSnapshot,
  isAllSitesOrigin,
} from "../../core/grants";
import type { Profile, Rule, Scope, StateDoc } from "../../core/model";
import { originPatternForDomain } from "../../core/scope";
import { siteAccessView } from "./site-access";

const baseRule = {
  id: "rule-1",
  num: 1,
  direction: "request",
  operation: "set",
  header: "x-debug",
  value: "on",
  enabled: true,
} as const;

function rule(
  scope: Scope,
  resourceTypes: Rule["resourceTypes"],
  initiators: string[] = [],
): Rule {
  return { ...baseRule, scope, resourceTypes, initiators };
}

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

  function apiProfile(): Profile {
    return profile("p1", [
      rule({ type: "domains", domains: ["api.example.com"] }, "all"),
    ]);
  }

  const enabledOverride = {
    num: 1,
    tabId: 5,
    origin: "https://api.example.com",
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

  it("counts enabled rules in the active profile for a held grant", () => {
    const granted = originPatternForDomain("api.example.com");
    const subject = doc([
      profile("p1", [
        {
          ...rule({ type: "domains", domains: ["api.example.com"] }, "all"),
          enabled: false,
        },
      ]),
      profile("p2", [
        {
          ...rule({ type: "domains", domains: ["api.example.com"] }, "all"),
          id: "rule-2",
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
        ruleCount: 0,
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

  it("counts a This-tab change covered by a narrowed grant on its partial row", () => {
    const observed = "https://api.example.com/*";
    const required = originPatternForDomain("api.example.com");
    const subject = doc([apiProfile()]);

    const view = siteAccessView(
      subject,
      { origins: [observed], allSites: false },
      [enabledOverride],
    );

    expect(view.needed).toEqual([]);
    expect(view.granted).toEqual([]);
    expect(view.partial).toMatchObject([
      {
        coverage: "partial",
        origin: required,
        domain: "api.example.com",
        ruleCount: 1,
        grantedOrigins: [observed],
        coveringOrigins: [observed],
      },
    ]);
    expect(view.partial[0]?.thisTabCount).toBe(1);
  });

  it("keeps every same-host origin that contributes to a partial row", () => {
    const origins = [
      "https://api.example.com/*",
      "http://api.example.com:8080/*",
      "https://*.api.example.com/*",
    ];

    expect(
      siteAccessView(
        doc([
          profile("p1", [
            rule({ type: "domains", domains: ["api.example.com"] }, "all"),
          ]),
        ]),
        { origins, allSites: false },
      ).partial,
    ).toMatchObject([
      {
        domain: "api.example.com",
        grantedOrigins: origins,
        coveringOrigins: origins,
      },
    ]);
  });

  it.each(["pattern", "regex"] as const)(
    "shows limited access without also listing a %s rule's domain as granted",
    (type) => {
      const observed = "https://api.example.com/*";
      const required = originPatternForDomain("api.example.com");
      const scope: Scope =
        type === "pattern"
          ? {
              type,
              pattern: "|https://api.example.com/path",
              hosts: ["api.example.com"],
            }
          : {
              type,
              regex: "^https://api\\.example\\.com/",
              hosts: ["api.example.com"],
            };
      const subject = doc([profile("p1", [rule(scope, "all")])]);

      expect(
        siteAccessView(subject, {
          origins: [observed],
          allSites: false,
        }),
      ).toMatchObject({
        needed: [],
        partial: [
          {
            coverage: "partial",
            origin: required,
            domain: "api.example.com",
            ruleCount: 1,
            grantedOrigins: [observed],
            coveringOrigins: [observed],
          },
        ],
        granted: [],
      });
    },
  );

  it.each([
    ["https://*.example.com/*", "example.com"],
    ["https://other.api.example.com/*", "other.api.example.com"],
  ])(
    "shows %s as coverage for api.example.com and as its own revocable row",
    (observed, grantedDomain) => {
      const subject = doc([apiProfile()]);

      expect(
        siteAccessView(subject, {
          origins: [observed],
          allSites: false,
        }),
      ).toMatchObject({
        needed: [],
        partial: [
          {
            coverage: "partial",
            domain: "api.example.com",
            ruleCount: 1,
            coveringOrigins: [observed],
          },
        ],
        granted: [
          {
            domain: grantedDomain,
            ruleCount: 1,
            grantedOrigins: [observed],
          },
        ],
      });
    },
  );

  it("never lists one domain as both granted and needing access", () => {
    const observed = "https://example.com/*";
    const domainsRule = rule(
      { type: "domains", domains: ["example.com"] },
      "all",
    );
    const patternRule = {
      ...rule(
        {
          type: "pattern",
          pattern: "||example.com^",
          hosts: ["example.com"],
        },
        "all",
      ),
      id: "rule-2",
      num: 2,
    };

    expect(
      siteAccessView(doc([profile("p1", [domainsRule, patternRule])]), {
        origins: [observed],
        allSites: false,
      }),
    ).toMatchObject({
      needed: [],
      partial: [
        {
          coverage: "partial",
          domain: "example.com",
          ruleCount: 2,
          grantedOrigins: [observed],
          coveringOrigins: [observed],
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
