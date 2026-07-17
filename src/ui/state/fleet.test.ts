import { describe, expect, it } from "vitest";
import type { GrantSnapshot } from "../../core/grants";
import type { Profile, Rule } from "../../core/model";
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
  input: Omit<FleetInput, "activeProfileId"> & {
    activeProfileId?: string | undefined;
  },
): FleetRule[] {
  const activeProfileId = input.activeProfileId ?? input.profiles[0]?.id;
  return projectFleetWithActive({ ...input, activeProfileId });
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
      paused: false,
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
      paused: false,
    });
    const entry = byKey(fleet, "p1:r");
    expect(entry.status).toBe("needs-access");
    expect(entry.missing).toEqual(["*://*.svc.test/*"]);
  });

  it("marks a Host rule refused even when granted", () => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r", header: "host" })] })],
      grants: ALL,
      paused: false,
    });
    expect(byKey(fleet, "p1:r").status).toBe("refused");
    expect(byKey(fleet, "p1:r").refused).toBe("host");
  });

  it("reads a disabled rule off, and pause never shows off as paused", () => {
    const fleet = projectFleet({
      profiles: [
        profile({
          rules: [rule({ id: "on" }), rule({ id: "off", enabled: false })],
        }),
      ],
      grants: ALL,
      paused: true,
    });
    expect(byKey(fleet, "p1:on").status).toBe("paused");
    expect(byKey(fleet, "p1:off").status).toBe("off");
  });

  it("reads every rule in an off profile as off", () => {
    const fleet = projectFleet({
      profiles: [profile({ rules: [rule({ id: "r" })] })],
      activeProfileId: "missing",
      grants: ALL,
      paused: false,
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
      paused: false,
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
      paused: false,
    });
    expect(byKey(fleet, "p1:l").overriddenBy).toEqual({
      label: "environment default",
    });
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
      paused: false,
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
      paused: false,
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
      paused: false,
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
      paused: false,
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
      paused: false,
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
          ],
        }),
      ],
      grants: ALL,
      paused: false,
    });
    const rows = tapeRows(groupBySite(fleet));
    const statuses = rows.map((row) => row.status);
    expect(statuses).toContain("live");
    expect(statuses).toContain("refused");
    expect(rows.some((row) => row.header === "host")).toBe(true);
    // The off rule is not traffic and never reaches the tape.
    expect(rows).toHaveLength(2);
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
      paused: false,
    });
    const rows = tapeRows(groupBySite(fleet));
    expect(rows[0]?.status).toBe("needs-access");
  });
});
