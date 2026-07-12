import { describe, expect, it } from "vitest";
import {
  ALL_SITES_ORIGIN,
  type GrantSnapshot,
  missingGrants,
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
