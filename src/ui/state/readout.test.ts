import { describe, expect, it } from "vitest";
import type { GrantSnapshot } from "../../core/grants";
import type { Profile, Rule, StateDoc, TabOverride } from "../../core/model";
import type { SystemStatus } from "../../core/status";
import { copy } from "../copy";
import { LIVE, OUT_OF_SYNC, PAUSED } from "../test/fixtures";
import {
  previewSwitch,
  computeReadout as projectReadout,
  type ReadoutInput,
  refusedReason,
} from "./readout";

const GRANTED: GrantSnapshot = { origins: [], allSites: true };
const NONE: GrantSnapshot = { origins: [], allSites: false };
const SUPPORT_ALL = () => true;

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
    rules: [],
    ...overrides,
  };
}

function state(activeProfile: Profile | undefined): StateDoc {
  return {
    v: 1,
    profiles: activeProfile === undefined ? [] : [activeProfile],
    activeProfileId: activeProfile?.id,
    nextRuleNum: 100,
    settings: { paused: false, theme: "system", badgeMode: "count" },
  };
}

function computeReadout(
  input: Omit<ReadoutInput, "doc" | "isRegexSupported"> & {
    activeProfile: Profile | undefined;
    isRegexSupported?: (regex: string) => boolean;
  },
) {
  const { activeProfile, isRegexSupported = SUPPORT_ALL, ...rest } = input;
  return projectReadout({
    ...rest,
    doc: state(activeProfile),
    isRegexSupported,
  });
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
  status: LIVE as SystemStatus,
};

describe("computeReadout", () => {
  it("is empty with no host", () => {
    const readout = computeReadout({
      ...base,
      host: undefined,
      activeProfile: undefined,
    });
    expect(readout.total).toBe(0);
    expect(readout.request).toHaveLength(0);
    expect(readout.token).toBeUndefined();
  });

  it("groups live changes by direction and counts them", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [
          rule({ header: "x-env" }),
          rule({
            header: "x-frame-options",
            direction: "response",
            operation: "remove",
          }),
        ],
      }),
    });
    expect(readout.total).toBe(2);
    expect(readout.request.map((c) => c.header)).toEqual(["x-env"]);
    expect(readout.response.map((c) => c.header)).toEqual(["x-frame-options"]);
    expect(readout.request[0]?.status).toBe("live");
  });

  it("lifts the authorization rule into the token and redacts its value", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [rule({ header: "authorization", value: "Bearer secret" })],
      }),
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
      activeProfile: profile({ rules: [rule()] }),
    });
    expect(readout.request[0]?.status).toBe("needs-access");
    expect(readout.request[0]?.missing).toEqual(["*://*.api.example.com/*"]);
    expect(readout.needsAccess).toBe(1);
  });

  it("marks a Host rule refused, honestly and enabled", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [rule({ header: "host", value: "x" })],
      }),
    });
    expect(readout.request[0]?.status).toBe("refused");
    expect(readout.request[0]?.refused).toBe("host");
    expect(readout.refused).toBe(1);
  });

  it("marks a same-profile collision overridden using the shared primitive", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [
          rule({ header: "x-env", comment: "staging environment" }),
          rule({ header: "x-env", value: "prod" }),
        ],
      }),
    });
    const loser = readout.request.find((c) => c.status === "overridden");
    expect(loser?.overriddenBy).toBe("staging environment");
    expect(readout.overridden).toBe(1);
    expect(readout.total).toBe(1);
  });

  it("does not let a compiler-dropped rule override a compiled rule", () => {
    const dropped = rule({ header: "x-env", value: "bad\nvalue" });
    const compiled = rule({ header: "x-env", value: "prod" });
    const readout = computeReadout({
      ...base,
      activeProfile: profile({ rules: [dropped, compiled] }),
    });

    expect(
      readout.request.find((change) => change.ruleId === dropped.id)?.status,
    ).toBe("refused");
    expect(
      readout.request.find((change) => change.ruleId === compiled.id)?.status,
    ).toBe("live");
    expect(readout.overridden).toBe(0);
  });

  it("never promotes an overridden authorization rule into the token hero", () => {
    const winner = rule({ header: "authorization", value: "Bearer winner" });
    const loser = rule({ header: "authorization", value: "Bearer loser" });
    const readout = computeReadout({
      ...base,
      activeProfile: profile({ rules: [winner, loser] }),
    });

    expect(readout.token?.ruleId).toBe(winner.id);
    expect(
      readout.request.find((change) => change.ruleId === loser.id)?.status,
    ).toBe("overridden");
    expect(readout.total).toBe(1);
  });

  it("renders a disabled rule off, uncounted, and never as the token", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [
          rule({
            header: "authorization",
            value: "Bearer x",
            enabled: false,
          }),
        ],
      }),
    });
    expect(readout.token).toBeUndefined();
    expect(readout.request[0]?.status).toBe("off");
    expect(readout.total).toBe(0);
  });

  it("keeps the token card through pause rather than restructuring the readout", () => {
    const rules = [rule({ header: "authorization", value: "Bearer x" })];
    const live = computeReadout({
      ...base,
      activeProfile: profile({ rules }),
    });
    const paused = computeReadout({
      ...base,
      status: PAUSED,
      activeProfile: profile({ rules }),
    });

    expect(live.token?.status).toBe("live");
    // Same rule, same shape: only the reading on the card moves.
    expect(paused.token?.key).toBe(live.token?.key);
    expect(paused.token?.status).toBe("paused");
    expect(paused.request).toEqual([]);
  });

  it("never reads live while Chrome has not taken the ruleset", () => {
    const readout = computeReadout({
      ...base,
      status: OUT_OF_SYNC,
      activeProfile: profile({
        rules: [rule({ header: "authorization", value: "Bearer x" })],
      }),
    });
    expect(readout.request[0]?.status).toBe("out-of-sync");
    expect(readout.outOfSync).toBe(1);
    // The hero is the loudest live claim in the popup; it may not be made.
    expect(readout.token).toBeUndefined();
  });

  it("declines to claim a pattern rule matches this tab", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [
          rule({
            scope: {
              type: "pattern",
              pattern: "||api.stripe.com^",
              hosts: ["api.example.com"],
            },
          }),
        ],
      }),
    });
    // Granted on this host, but the urlFilter is what Chrome matches on, and
    // this projection cannot evaluate it.
    expect(readout.request[0]?.status).toBe("unconfirmed");
    expect(readout.unconfirmed).toBe(1);
  });

  it("declines to claim a regex rule matches this tab, however broad its grant", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [
          rule({ scope: { type: "regex", regex: "^https://x/", hosts: [] } }),
        ],
      }),
    });
    expect(readout.request[0]?.status).toBe("unconfirmed");
  });

  it("refuses a regex the browser reports unsupported", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [
          rule({ scope: { type: "regex", regex: "(?=bad)", hosts: [] } }),
        ],
      }),
      isRegexSupported: () => false,
    });
    expect(readout.request[0]?.status).toBe("refused");
    expect(readout.request[0]?.refused).toBe("regex");
  });

  it("declines to claim a rule fires when initiators decide it per request", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [rule({ initiators: ["app.example.com"] })],
      }),
    });
    expect(readout.request[0]?.status).toBe("unconfirmed");
  });

  it.each([
    [
      "a domain Chrome refuses",
      {
        scope: {
          type: "domains" as const,
          domains: ["api.example.com", "exämple.com"],
        },
      },
      "domains",
    ],
    ["a line break in the value", { value: "a\r\nb" }, "value"],
    ["a pseudo-header name", { header: ":authority" }, "header"],
    [
      "a urlFilter Chrome rejects",
      { scope: { type: "pattern" as const, pattern: "||*", hosts: [] } },
      "pattern",
    ],
  ])("refuses a rule the compiler drops: %s", (_label, changes, reason) => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({ rules: [rule(changes)] }),
    });
    const line = readout.request[0];
    expect(line?.status).toBe("refused");
    expect(line?.refused).toBe(reason);
    expect(readout.refused).toBe(1);
  });

  it("lifts a this-tab authorization swap into the token, out of the strip", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: undefined,
      overrides: [
        override({ num: 7, header: "authorization", value: "Bearer swapped" }),
        override({ num: 8, header: "x-flag", value: "1" }),
      ],
    });
    expect(readout.token?.overrideNum).toBe(7);
    expect(readout.overrides.map((o) => o.overrideNum)).toEqual([8]);
  });

  it("counts an override-only reconcile failure in the summary", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: undefined,
      overrides: [override()],
      status: OUT_OF_SYNC,
    });
    expect(readout.total).toBe(1);
    expect(readout.outOfSync).toBe(1);
  });
});

describe("refusedReason", () => {
  it("flags the Host header and clears everything else", () => {
    expect(refusedReason(rule({ header: "host" }), SUPPORT_ALL)).toBe("host");
    expect(
      refusedReason(rule({ header: "x-env" }), SUPPORT_ALL),
    ).toBeUndefined();
  });

  it("maps append refusal separately from an invalid header name", () => {
    expect(
      refusedReason(
        rule({ operation: "append", header: "content-type" }),
        SUPPORT_ALL,
      ),
    ).toBe("append");
    expect(copy.readout.refusedReason.append).toBe(
      "Chrome accepts this header name, but only allows appending to a fixed set of request headers. Use Set instead.",
    );
    expect(refusedReason(rule({ header: ":authority" }), SUPPORT_ALL)).toBe(
      "header",
    );
  });
});

describe("previewSwitch", () => {
  it("diffs the target profile against what is live now on this tab", () => {
    const from = profile({
      rules: [
        rule({ header: "authorization", value: "Bearer x" }),
        rule({ header: "x-env" }),
      ],
    });
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
    expect(previewSwitch(undefined, profile(), undefined)).toEqual({
      drops: [],
      adds: [],
    });
  });
});
