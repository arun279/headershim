import { describe, expect, it } from "vitest";
import type { GrantSnapshot } from "../../core/grants";
import type { Profile, Rule, StateDoc } from "../../core/model";
import { LIVE, OUT_OF_SYNC, PAUSED } from "../test/fixtures";
import {
  type FleetInput,
  type FleetRule,
  groupByHeader,
  groupBySite,
  projectFleet as projectFleetWithActive,
  tapeRows,
} from "./fleet";

const ALL: GrantSnapshot = { origins: [], allSites: true };
const NONE: GrantSnapshot = { origins: [], allSites: false };
const SUPPORT_ALL = () => true;

let seq = 0;
const baseRule: Omit<Rule, "id" | "num"> = {
  direction: "request",
  operation: "set",
  header: "x-flag",
  value: "on",
  scope: { type: "domains", domains: ["svc.test"] },
  resourceTypes: "all",
  initiators: [],
  enabled: true,
};
const rule = (overrides: Partial<Rule> = {}): Rule => {
  seq += 1;
  return { ...baseRule, id: `rule-${seq}`, num: seq, ...overrides };
};
const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: "p1",
  name: "Staging",
  badgeText: "ST",
  color: "blue",
  rules: [],
  ...overrides,
});

function projectFleet(
  input: Omit<FleetInput, "doc" | "isRegexSupported"> & {
    profiles: readonly Profile[];
    activeProfileId?: string | undefined;
    isRegexSupported?: (regex: string) => boolean;
  },
): FleetRule[] {
  const activeProfileId = input.activeProfileId ?? input.profiles[0]?.id;
  const doc: StateDoc = {
    v: 1,
    profiles: [...input.profiles],
    activeProfileId,
    nextRuleNum: 100,
    settings: { paused: false, theme: "system" },
  };
  return projectFleetWithActive({
    doc,
    grants: input.grants,
    status: input.status,
    isRegexSupported: input.isRegexSupported ?? SUPPORT_ALL,
  });
}

function byKey(fleet: readonly FleetRule[], key: string): FleetRule {
  const found = fleet.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`no fleet rule ${key}`);
  return found;
}

describe("projectFleet status ladder", () => {
  it("marks a granted enabled rule live and carries provenance", () => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r" })] })],
      grants: ALL,
      status: LIVE,
    });
    const entry = byKey(fleet, "p1:r");
    expect(entry.status).toBe("live");
    expect(entry.provenance).toMatchObject({ name: "Staging", color: "blue" });
    expect(entry.siteCount).toBe(1);
    expect(entry.crossSite).toBe(false);
  });

  it("marks an ungranted rule needs-access with the missing origin", () => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r" })] })],
      grants: NONE,
      status: LIVE,
    });
    const entry = byKey(fleet, "p1:r");
    expect(entry.status).toBe("needs-access");
    expect(entry.missing).toEqual(["*://*.svc.test/*"]);
  });

  it("marks a Host rule refused even when granted", () => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r", header: "host" })] })],
      grants: ALL,
      status: LIVE,
    });
    expect(byKey(fleet, "p1:r").status).toBe("refused");
    expect(byKey(fleet, "p1:r").refused).toBe("host");
  });

  it("marks a network-managed rule managed rather than live", () => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r", header: "connection" })] })],
      grants: ALL,
      status: LIVE,
    });
    expect(byKey(fleet, "p1:r").status).toBe("managed");
  });

  it("lets compiler refusal outrank network-managed classification", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({
              id: "r",
              operation: "append",
              header: "content-length",
            }),
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });
    const entry = byKey(fleet, "p1:r");
    expect(entry.status).toBe("refused");
    expect(entry.refused).toBe("append");
    expect(fleet.filter((rule) => rule.status === "managed")).toHaveLength(0);
    expect(
      fleet.filter(
        (rule) => rule.status === "live" || rule.status === "unconfirmed",
      ),
    ).toHaveLength(0);
  });

  it("never reads live while Chrome has not taken the ruleset", () => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r" })] })],
      grants: ALL,
      status: OUT_OF_SYNC,
    });
    expect(byKey(fleet, "p1:r").status).toBe("out-of-sync");
  });

  // Chrome settles each of these inside its own matcher, against a request URL
  // no projection sees. The Workbench reads them the same way the popup does,
  // so a rule can never be unconfirmed on one surface and live on the other.
  it.each([
    ["initiators", { initiators: ["app.test"] }],
    [
      "a pattern",
      { scope: { type: "pattern" as const, pattern: "||x.test/", hosts: [] } },
    ],
    [
      "a regex",
      {
        scope: {
          type: "regex" as const,
          regex: "^https://x\\.test/",
          hosts: [],
        },
      },
    ],
  ])("declines to claim a rule fires when %s decides it per request", (_label, changes) => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r", ...changes })] })],
      grants: ALL,
      status: LIVE,
    });
    expect(byKey(fleet, "p1:r").status).toBe("unconfirmed");
  });

  it("refuses a rule the compiler would drop from the batch", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({
              id: "r",
              scope: { type: "domains", domains: ["sürvice.test"] },
            }),
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });
    expect(byKey(fleet, "p1:r").status).toBe("refused");
    expect(byKey(fleet, "p1:r").refused).toBe("domains");
  });

  it("reads a disabled rule off, and pause never shows off as paused", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [rule({ id: "on" }), rule({ id: "off", enabled: false })],
        }),
      ],
      grants: ALL,
      status: PAUSED,
    });
    expect(byKey(fleet, "p1:on").status).toBe("paused");
    expect(byKey(fleet, "p1:off").status).toBe("off");
  });

  it("reads every rule in an off profile as off", () => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r" })] })],
      activeProfileId: "missing",
      grants: ALL,
      status: LIVE,
    });
    expect(byKey(fleet, "p1:r").status).toBe("off");
  });

  it("never reports a collision across an inactive profile", () => {
    const winner = profile({
      id: "p1",
      name: "Base",
      rules: [rule({ id: "w", header: "x-env", scope: { type: "all" } })],
    });
    const loser = profile({
      id: "p2",
      name: "Extra",
      rules: [rule({ id: "l", header: "x-env" })],
    });
    const fleet = projectFleet({
      profiles: [winner, loser],
      grants: ALL,
      status: LIVE,
    });
    const entry = byKey(fleet, "p2:l");
    expect(entry.status).toBe("off");
    expect(entry.overriddenBy).toBeUndefined();
  });

  it("names the winning same-profile rule", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({
              id: "w",
              header: "x-env",
              comment: "environment default",
              scope: { type: "all" },
            }),
            rule({ id: "l", header: "x-env" }),
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });
    expect(byKey(fleet, "p1:l").overriddenBy).toEqual({
      label: "environment default",
    });
  });

  it("does not let a compiler-dropped rule override a compiled rule", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({ id: "dropped", header: "x-env", value: "bad\nvalue" }),
            rule({ id: "compiled", header: "x-env", value: "prod" }),
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });

    expect(byKey(fleet, "p1:dropped").status).toBe("refused");
    expect(byKey(fleet, "p1:compiled").status).toBe("live");
    expect(tapeRows(groupBySite(fleet)).map((row) => row.header)).toEqual([
      "x-env",
      "x-env",
    ]);
  });

  it("redacts secret values and drops the value for a remove", () => {
    const { value: _drop, ...removeRule } = rule({
      id: "d",
      operation: "remove",
    });
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({ id: "s", header: "authorization", value: "Bearer abc123" }),
            removeRule,
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });
    expect(byKey(fleet, "p1:s").display).toBe("Bearer …redacted");
    expect(byKey(fleet, "p1:d").display).toBeUndefined();
  });
});

describe("groupBySite", () => {
  it("lists a multi-domain rule under each domain, sorted", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({
              id: "r",
              scope: { type: "domains", domains: ["b.com", "a.com"] },
            }),
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });
    const groups = groupBySite(fleet);
    expect(groups.map((group) => group.host)).toEqual(["a.com", "b.com"]);
    expect(byKey(fleet, "p1:r").siteCount).toBe(2);
  });

  it("collects all-sites, pattern, and regex rules into one cross-site group", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({ id: "d" }),
            rule({ id: "a", scope: { type: "all" } }),
            rule({
              id: "p",
              scope: { type: "pattern", pattern: "||x.com/", hosts: [] },
            }),
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });
    const groups = groupBySite(fleet);
    const cross = groups.find((group) => group.kind === "cross-site");
    expect(cross?.rules.map((entry) => entry.ruleId)).toEqual(["a", "p"]);
  });
});

describe("groupByHeader", () => {
  it("gathers one header across sites and reports the blast radius", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({
              id: "1",
              header: "X-Env",
              scope: { type: "domains", domains: ["a.com"] },
            }),
            rule({
              id: "2",
              header: "x-env",
              scope: { type: "domains", domains: ["b.com"] },
            }),
            rule({ id: "3", header: "Cache-Control" }),
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });
    const groups = groupByHeader(fleet);
    expect(groups.map((group) => group.header)).toEqual([
      "Cache-Control",
      "X-Env",
    ]);
    const env = groups.find((group) => group.headerKey === "x-env");
    expect(env?.rules).toHaveLength(2);
    expect(env?.siteCount).toBe(2);
    expect(env?.broad).toBe(false);
  });

  it("marks a header broad when any rule reaches beyond named sites", () => {
    const fleet = projectFleet({
      profiles: [
        profile({ rules: [rule({ id: "r", scope: { type: "all" } })] }),
      ],
      grants: ALL,
      status: LIVE,
    });
    expect(groupByHeader(fleet)[0]?.broad).toBe(true);
  });
});

describe("tapeRows", () => {
  it("carries live, skipped, and refused stamps but never off or overridden", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({
              id: "live",
              scope: { type: "domains", domains: ["a.com"] },
            }),
            rule({ id: "off", enabled: false }),
            rule({ id: "host", header: "host" }),
            rule({ id: "managed", header: "connection" }),
          ],
        }),
      ],
      grants: ALL,
      status: LIVE,
    });
    const rows = tapeRows(groupBySite(fleet));
    const statuses = rows.map((row) => row.status);
    expect(statuses).toContain("live");
    expect(statuses).toContain("refused");
    expect(statuses).toContain("managed");
    expect(rows.some((row) => row.header === "host")).toBe(true);
    // The off rule is not traffic and never reaches the tape.
    expect(rows).toHaveLength(3);
    // Refused sorts ahead of live.
    expect(rows[0]?.status).toBe("refused");
  });

  it("skips ungranted rules and orders skipped ahead of live", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [
            rule({ id: "g", scope: { type: "domains", domains: ["a.com"] } }),
          ],
        }),
      ],
      grants: NONE,
      status: LIVE,
    });
    const rows = tapeRows(groupBySite(fleet));
    expect(rows[0]?.status).toBe("needs-access");
  });
});
