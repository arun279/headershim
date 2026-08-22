import { describe, expect, it } from "vitest";
import { type Applied, confirm } from "../../core/applied";
import { compile } from "../../core/compile";
import type { GrantSnapshot } from "../../core/grants";
import type { Profile, Rule, StateDoc } from "../../core/model";
import { ruleKey } from "../../core/verdict";
import { confirmedBatch } from "../test/fixtures";
import { fleetRules, groupByHeader, groupBySite, tapeRows } from "./fleet";

const ALL_SITES: GrantSnapshot = { origins: [], allSites: true };

const BASE_RULE: Omit<Rule, "id" | "num"> = {
  direction: "request",
  operation: "set",
  header: "x-flag",
  value: "on",
  scope: { type: "domains", domains: ["api.example.com"] },
  resourceTypes: "all",
  initiators: [],
  enabled: true,
};

function rule(id: string, num: number, changes: Partial<Rule> = {}): Rule {
  return { ...BASE_RULE, id, num, ...changes };
}

function profile(
  id: string,
  rules: Rule[],
  changes: Partial<Profile> = {},
): Profile {
  return {
    id,
    name: id === "staging" ? "Staging" : "Inactive",
    badgeText: id === "staging" ? "ST" : "IN",
    color: id === "staging" ? "blue" : "slate",
    rules,
    ...changes,
  };
}

function document(
  profiles: Profile[],
  activeProfileId = profiles[0]?.id ?? "",
): StateDoc {
  return {
    v: 1,
    profiles,
    activeProfileId,
    nextRuleNum: 100,
    settings: { paused: false, theme: "system" },
  };
}

function compileApplied(
  doc: StateDoc,
  granted: GrantSnapshot = ALL_SITES,
): Applied {
  return confirmedBatch({
    doc,
    overrides: [],
    granted,
    isRegexSupported: () => true,
  }).applied;
}

describe("fleetRules", () => {
  it("combines authored metadata with the installed scope", () => {
    const credential = rule("credential", 1, {
      header: "Authorization",
      value: "Bearer abc123",
      scope: {
        type: "domains",
        domains: ["api.example.com", "other.example.com"],
      },
      comment: "API credential",
    });
    const doc = document([profile("staging", [credential])]);
    const applied = compileApplied(doc, {
      origins: ["https://api.example.com/*"],
      allSites: false,
    });

    expect(fleetRules(applied)).toEqual([
      expect.objectContaining({
        key: ruleKey("staging", "credential", 0),
        profileId: "staging",
        ruleId: "credential",
        provenance: {
          profileId: "staging",
          name: "Staging",
          badgeText: "ST",
          color: "blue",
        },
        headerKey: "authorization",
        direction: "request",
        operation: "set",
        header: "Authorization",
        display: "Bearer [hidden]",
        secret: true,
        enabled: true,
        paused: false,
        outcome: {
          kind: "partial",
          scope: {
            kind: "sites",
            domains: ["api.example.com"],
            origins: ["https://api.example.com"],
          },
          reason: {
            kind: "ungranted",
            missing: ["*://*.api.example.com/*", "*://*.other.example.com/*"],
          },
        },
        scope: {
          type: "domains",
          domains: ["api.example.com", "other.example.com"],
        },
        crossSite: false,
        comment: "API credential",
      }),
    ]);
  });

  it("holds a placed rule at pending while an absent one keeps its reason", () => {
    const doc = document([
      profile("staging", [rule("flag", 1), rule("off", 2, { enabled: false })]),
    ]);
    const pending = confirm(
      compile({
        doc,
        overrides: [],
        granted: ALL_SITES,
        isRegexSupported: () => true,
      }),
      { dynamic: "dynamic", session: "session" },
      { dynamic: "stale", session: "stale" },
    );

    expect(fleetRules(pending).map((entry) => entry.outcome)).toEqual([
      {
        kind: "pending",
        scope: { kind: "sites", domains: ["api.example.com"] },
      },
      { kind: "absent", reason: { kind: "off" } },
    ]);
  });
});

describe("fleet grouping", () => {
  it("groups authored sites and projected header reach independently", () => {
    const rules = [
      rule("multi-site", 1, {
        header: "X-Env",
        scope: { type: "domains", domains: ["b.test", "a.test"] },
      }),
      rule("third-site", 2, {
        header: "x-env",
        scope: { type: "domains", domains: ["c.test"] },
      }),
      rule("cross-site", 3, {
        header: "X-Global",
        scope: { type: "all" },
      }),
    ];
    const doc = document([profile("staging", rules)]);
    const fleet = fleetRules(compileApplied(doc));

    const sites = groupBySite(fleet);
    expect(sites.map((group) => group.host)).toEqual([
      "a.test",
      "b.test",
      "c.test",
      "*",
    ]);
    expect(sites[0]?.rules.map((entry) => entry.ruleId)).toEqual([
      "multi-site",
    ]);
    expect(sites[3]).toMatchObject({
      kind: "cross-site",
      rules: [expect.objectContaining({ ruleId: "cross-site" })],
    });

    const headers = groupByHeader(fleet);
    expect(headers.map((group) => group.headerKey)).toEqual([
      "x-env",
      "x-global",
    ]);
    expect(headers[0]).toMatchObject({
      siteCount: 3,
      broad: false,
      allSites: false,
    });
    expect(headers[1]).toMatchObject({
      siteCount: 0,
      broad: true,
      allSites: true,
    });
  });

  it("counts only installed domains in a header's reach", () => {
    const live = rule("live", 1, {
      header: "x-env",
      scope: { type: "domains", domains: ["a.test"] },
    });
    const off = rule("off", 2, {
      header: "x-env",
      enabled: false,
      scope: { type: "domains", domains: ["b.test"] },
    });
    const doc = document([profile("staging", [live, off])]);

    expect(groupByHeader(fleetRules(compileApplied(doc)))[0]).toMatchObject({
      siteCount: 1,
      broad: false,
    });
  });
});

describe("tapeRows", () => {
  it("keeps an exact-origin site partial and names the missing site", () => {
    const partial = rule("partial", 1, {
      scope: {
        type: "domains",
        domains: ["api.example.com", "other.example.com"],
      },
    });
    const doc = document([profile("staging", [partial])]);
    const applied = compileApplied(doc, {
      origins: ["https://api.example.com/*"],
      allSites: false,
    });
    const rows = tapeRows(groupBySite(fleetRules(applied)), applied);

    expect(
      rows.find((row) => row.host === "api.example.com")?.outcome.kind,
    ).toBe("partial");
    expect(
      rows.find((row) => row.host === "other.example.com")?.outcome,
    ).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted",
        missing: ["*://*.other.example.com/*"],
      },
    });
  });

  it("includes every placed key and filters only off or other-profile rows", () => {
    const active = profile("staging", [
      rule("placed", 1, {
        scope: { type: "domains", domains: ["a.test", "b.test"] },
      }),
      rule("off", 2, {
        enabled: false,
        scope: { type: "domains", domains: ["a.test"] },
      }),
      rule("refused", 3, {
        header: ":authority",
        scope: { type: "domains", domains: ["a.test"] },
      }),
      rule("ungranted", 4, {
        scope: { type: "domains", domains: ["missing.test"] },
      }),
    ]);
    const inactive = profile("inactive", [
      rule("other-profile", 5, {
        scope: { type: "domains", domains: ["a.test"] },
      }),
    ]);
    const doc = document([active, inactive], active.id);
    const applied = compileApplied(doc, {
      origins: ["*://*.a.test/*", "*://*.b.test/*"],
      allSites: false,
    });
    const fleet = fleetRules(applied);
    const groups = groupBySite(fleet);
    const rows = tapeRows(groups, applied);

    const expectedRows = groups
      .flatMap((group) =>
        group.rules.flatMap((entry) =>
          entry.outcome.kind === "absent" &&
          (entry.outcome.reason.kind === "off" ||
            entry.outcome.reason.kind === "other-profile")
            ? []
            : [`${group.host}:${entry.key}`],
        ),
      )
      .toSorted();
    expect(rows.map((row) => row.key)).toEqual(
      expect.arrayContaining(expectedRows),
    );
    expect(rows).toHaveLength(expectedRows.length);

    const placedKeys = fleet
      .filter((entry) => entry.outcome.kind === "placed")
      .map((entry) => entry.key)
      .toSorted();
    expect(
      placedKeys.filter((key) =>
        rows.some((row) => row.key.endsWith(`:${key}`)),
      ),
    ).toEqual(placedKeys);

    const omittedReasons = groups.flatMap((group) =>
      group.rules.flatMap((entry) => {
        if (rows.some((row) => row.key === `${group.host}:${entry.key}`)) {
          return [];
        }
        return entry.outcome.kind === "absent"
          ? [entry.outcome.reason.kind]
          : [];
      }),
    );
    expect(new Set(omittedReasons)).toEqual(new Set(["off", "other-profile"]));
    expect(
      rows.some(
        (row) =>
          row.outcome.kind === "absent" &&
          row.outcome.reason.kind === "refused",
      ),
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.outcome.kind === "absent" &&
          row.outcome.reason.kind === "ungranted",
      ),
    ).toBe(true);
  });
});
