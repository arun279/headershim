import { describe, expect, it } from "vitest";
import {
  ALL_SITES_ORIGIN,
  docMissingGrants,
  type GrantSnapshot,
  isAllSitesOrigin,
  missingGrants,
  requiredOrigins,
  siteAccessView,
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
    expect(
      missingGrants(subject, {
        origins: ["https://*.example.com/*"],
        allSites: false,
      }),
    ).toEqual([originPatternForDomain("api.example.com")]);
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

describe("docMissingGrants", () => {
  const none: GrantSnapshot = { origins: [], allSites: false };

  it("reports gaps only for enabled rules inside enabled profiles", () => {
    const ungranted = rule(
      { type: "domains", domains: ["api.example.com"] },
      "all",
    );
    const disabledRule = {
      ...rule({ type: "domains", domains: ["off.example.com"] }, "all"),
      id: "rule-2",
      enabled: false,
    };
    const doc: StateDoc = {
      v: 1,
      profiles: [
        {
          id: "profile-on",
          name: "On",
          badgeText: "ON",
          color: "blue",
          enabled: true,
          rules: [ungranted, disabledRule],
        },
        {
          id: "profile-off",
          name: "Off",
          badgeText: "OF",
          color: "teal",
          enabled: false,
          rules: [{ ...ungranted, id: "rule-3" }],
        },
      ],
      focusedProfileId: "profile-on",
      nextRuleNum: 4,
      settings: { paused: false, theme: "system", badgeMode: "count" },
    };

    expect(docMissingGrants(doc, none)).toEqual([
      {
        profileId: "profile-on",
        ruleId: "rule-1",
        missing: [originPatternForDomain("api.example.com")],
      },
    ]);
    expect(docMissingGrants(doc, { origins: [], allSites: true })).toEqual([]);
  });
});

describe("siteAccessView", () => {
  const none: GrantSnapshot = { origins: [], allSites: false };

  function doc(profiles: Profile[]): StateDoc {
    return {
      v: 1,
      profiles,
      focusedProfileId: profiles[0]?.id ?? "",
      nextRuleNum: 100,
      settings: { paused: false, theme: "system", badgeMode: "count" },
    };
  }

  function profile(id: string, enabled: boolean, rules: Rule[]): Profile {
    return { id, name: id, badgeText: "PR", color: "blue", enabled, rules };
  }

  it("aggregates needed origins across rules, sorted by domain", () => {
    const subject = doc([
      profile("p1", true, [
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
        origin: originPatternForDomain("api.example.com"),
        domain: "api.example.com",
        ruleCount: 2,
      },
      {
        origin: originPatternForDomain("zeta.example.com"),
        domain: "zeta.example.com",
        ruleCount: 1,
      },
    ]);
  });

  it("routes broad needs to the all-sites card, never a needed row", () => {
    const subject = doc([profile("p1", true, [rule({ type: "all" }, "all")])]);

    expect(siteAccessView(subject, none).needed).toEqual([]);
  });

  it("counts every rule that references a grant, enabled or not", () => {
    const granted = originPatternForDomain("api.example.com");
    const subject = doc([
      profile("p1", false, [
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
    ).toEqual([{ origin: granted, domain: "api.example.com", ruleCount: 2 }]);
  });

  it("keeps a rule-less grant listed with a zero count", () => {
    const granted = originPatternForDomain("old.example.com");

    expect(
      siteAccessView(doc([]), { origins: [granted], allSites: false }).granted,
    ).toEqual([{ origin: granted, domain: "old.example.com", ruleCount: 0 }]);
  });

  it("excludes the broad origin from the granted list", () => {
    expect(
      siteAccessView(doc([]), {
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
      siteAccessView(doc([profile("p1", true, [bare])]), none).initiatorNote,
    ).toBe(true);
    expect(
      siteAccessView(
        doc([
          profile("p1", true, [
            { ...bare, initiators: ["app.example.com"] },
            { ...bare, id: "rule-2", resourceTypes: ["pages"] },
            { ...bare, id: "rule-3", enabled: false },
          ]),
          profile("p2", false, [{ ...bare, id: "rule-4" }]),
        ]),
        none,
      ).initiatorNote,
    ).toBe(false);
    expect(
      siteAccessView(doc([profile("p1", true, [bare])]), {
        origins: [ALL_SITES_ORIGIN],
        allSites: true,
      }).initiatorNote,
    ).toBe(false);
  });
});
