import { describe, expect, it } from "vitest";
import type { GrantSnapshot } from "../../core/grants";
import type { Profile, Rule, TabOverride } from "../../core/model";
import { computeReadout, previewSwitch, refusedReason } from "./readout";

const GRANTED: GrantSnapshot = { origins: [], allSites: true };
const NONE: GrantSnapshot = { origins: [], allSites: false };

let seq = 0;
function rule(overrides: Partial<Rule> = {}): Rule {
  seq += 1;
  return {
    id: `rule-${seq}`,
    num: seq,
    direction: "request",
    operation: "set",
    header: "x-env",
    value: "staging",
    scope: { type: "domains", domains: ["api.example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "p-default",
    name: "Default",
    badgeText: "DE",
    color: "indigo",
    enabled: true,
    rules: [],
    ...overrides,
  };
}

function override(overrides: Partial<TabOverride> = {}): TabOverride {
  return {
    num: 1,
    tabId: 5,
    originHost: "api.example.com",
    direction: "request",
    operation: "set",
    header: "x-flag",
    value: "1",
    enabled: true,
    ...overrides,
  };
}

const base = {
  host: "api.example.com" as string | undefined,
  grants: GRANTED,
  overrides: [] as TabOverride[],
  paused: false,
};

describe("computeReadout", () => {
  it("is empty with no host", () => {
    const readout = computeReadout({
      ...base,
      host: undefined,
      enabledProfiles: [],
    });
    expect(readout.total).toBe(0);
    expect(readout.request).toHaveLength(0);
    expect(readout.token).toBeUndefined();
  });

  it("groups live changes by direction and counts them", () => {
    const readout = computeReadout({
      ...base,
      enabledProfiles: [
        profile({
          rules: [
            rule({ header: "x-env" }),
            rule({
              header: "x-frame-options",
              direction: "response",
              operation: "remove",
            }),
          ],
        }),
      ],
    });
    expect(readout.total).toBe(2);
    expect(readout.request.map((c) => c.header)).toEqual(["x-env"]);
    expect(readout.response.map((c) => c.header)).toEqual(["x-frame-options"]);
    expect(readout.request[0]?.status).toBe("live");
  });

  it("lifts the authorization rule into the token and redacts its value", () => {
    const readout = computeReadout({
      ...base,
      enabledProfiles: [
        profile({
          rules: [rule({ header: "authorization", value: "Bearer secret" })],
        }),
      ],
    });
    expect(readout.token?.header).toBe("authorization");
    expect(readout.token?.value).toBe("Bearer secret");
    expect(readout.token?.display).toBe("Bearer …redacted");
    // Counted, but not repeated in the request list.
    expect(readout.total).toBe(1);
    expect(readout.request).toHaveLength(0);
  });

  it("marks an ungranted rule needs-access with the origins to grant", () => {
    const readout = computeReadout({
      ...base,
      grants: NONE,
      enabledProfiles: [profile({ rules: [rule()] })],
    });
    expect(readout.request[0]?.status).toBe("needs-access");
    expect(readout.request[0]?.missing).toEqual(["*://*.api.example.com/*"]);
    expect(readout.needsAccess).toBe(1);
  });

  it("marks a Host rule refused, honestly and enabled", () => {
    const readout = computeReadout({
      ...base,
      enabledProfiles: [
        profile({ rules: [rule({ header: "host", value: "x" })] }),
      ],
    });
    expect(readout.request[0]?.status).toBe("refused");
    expect(readout.request[0]?.refused).toBe("host");
    expect(readout.refused).toBe(1);
  });

  it("names the winning profile when two enabled profiles collide", () => {
    const readout = computeReadout({
      ...base,
      enabledProfiles: [
        profile({
          id: "p-a",
          name: "Staging auth",
          rules: [rule({ header: "x-env" })],
        }),
        profile({
          id: "p-b",
          name: "CORS dev",
          rules: [rule({ header: "x-env", value: "prod" })],
        }),
      ],
    });
    expect(readout.multiProfile).toBe(true);
    const loser = readout.request.find((c) => c.status === "overridden");
    expect(loser?.overriddenBy).toBe("Staging auth");
    expect(loser?.provenance?.name).toBe("CORS dev");
    expect(readout.overridden).toBe(1);
  });

  it("renders a disabled rule off, uncounted, and never as the token", () => {
    const readout = computeReadout({
      ...base,
      enabledProfiles: [
        profile({
          rules: [
            rule({
              header: "authorization",
              value: "Bearer x",
              enabled: false,
            }),
          ],
        }),
      ],
    });
    expect(readout.token).toBeUndefined();
    expect(readout.request[0]?.status).toBe("off");
    expect(readout.total).toBe(0);
  });

  it("drops every line to paused and keeps the token inline", () => {
    const readout = computeReadout({
      ...base,
      paused: true,
      enabledProfiles: [
        profile({
          rules: [rule({ header: "authorization", value: "Bearer x" })],
        }),
      ],
    });
    expect(readout.token).toBeUndefined();
    expect(readout.request[0]?.status).toBe("paused");
  });

  it("lifts a this-tab authorization swap into the token, out of the strip", () => {
    const readout = computeReadout({
      ...base,
      enabledProfiles: [],
      overrides: [
        override({ num: 7, header: "authorization", value: "Bearer swapped" }),
        override({ num: 8, header: "x-flag", value: "1" }),
      ],
    });
    expect(readout.token?.overrideNum).toBe(7);
    expect(readout.overrides.map((o) => o.overrideNum)).toEqual([8]);
  });
});

describe("refusedReason", () => {
  it("flags the Host header and clears everything else", () => {
    expect(refusedReason(rule({ header: "host" }))).toBe("host");
    expect(refusedReason(rule({ header: "x-env" }))).toBeUndefined();
  });
});

describe("previewSwitch", () => {
  it("diffs the target profile against what is live now on this tab", () => {
    const from = [
      profile({
        rules: [
          rule({ header: "authorization", value: "Bearer x" }),
          rule({ header: "x-env" }),
        ],
      }),
    ];
    const to = profile({
      id: "p-target",
      name: "Prod read-only",
      rules: [rule({ header: "x-read-only", value: "1" })],
    });
    const preview = previewSwitch(from, to, "api.example.com");
    expect(preview.drops).toEqual(["authorization", "x-env"]);
    expect(preview.adds).toEqual([{ header: "x-read-only", display: "1" }]);
  });

  it("is empty without a host", () => {
    expect(previewSwitch([], profile(), undefined)).toEqual({
      drops: [],
      adds: [],
    });
  });
});
