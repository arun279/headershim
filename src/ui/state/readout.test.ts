import { describe, expect, it } from "vitest";
import type { GrantSnapshot } from "../../core/grants";
import type { Profile, Rule, StateDoc, TabOverride } from "../../core/model";
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

function state(activeProfile: Profile): StateDoc {
  return {
    v: 1,
    profiles: [activeProfile],
    activeProfileId: activeProfile.id,
    nextRuleNum: 100,
    settings: { paused: false, theme: "system" },
  };
}

function computeReadout(
  input: Omit<ReadoutInput, "doc" | "isRegexSupported"> & {
    activeProfile: Profile;
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

function expectSingleUnconfirmed(
  readout: ReturnType<typeof computeReadout>,
): void {
  expect(readout.request[0]?.status).toBe("unconfirmed");
  expect(readout.unconfirmed).toBe(1);
  expect(readout.total).toBe(1);
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
  status: LIVE,
};

describe("computeReadout", () => {
  it("is empty with no host", () => {
    const readout = computeReadout({
      ...base,
      host: undefined,
      activeProfile: profile(),
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
    expect(readout.token?.display).toBe("Bearer [hidden]");
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
    expect(readout.total).toBe(0);
  });

  it.each([
    ["request", "connection"],
    ["response", "content-length"],
  ] as const)(
    "marks a %s network-managed header managed and uncounted",
    (direction, header) => {
      const readout = computeReadout({
        ...base,
        activeProfile: profile({ rules: [rule({ direction, header })] }),
      });
      const line = [...readout.request, ...readout.response][0];
      expect(line?.status).toBe("managed");
      expect(readout.managed).toBe(1);
      expect(readout.total).toBe(0);
    },
  );

  it("lets compiler refusal outrank network-managed classification", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile({
        rules: [
          rule({
            operation: "append",
            header: "content-length",
          }),
        ],
      }),
    });
    expect(readout.request[0]?.status).toBe("refused");
    expect(readout.request[0]?.refused).toBe("append");
    expect(readout.refused).toBe(1);
    expect(readout.managed).toBe(0);
    expect(readout.total).toBe(0);
  });

  it("marks a network-managed this-tab override managed and uncounted", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile(),
      overrides: [override({ header: "connection" })],
    });
    expect(readout.overrides[0]?.status).toBe("managed");
    expect(readout.managed).toBe(1);
    expect(readout.total).toBe(0);
  });

  it("marks a this-tab override needs-access when its host is not granted", () => {
    const readout = computeReadout({
      ...base,
      grants: NONE,
      activeProfile: profile(),
      overrides: [override()],
    });

    expect(readout.overrides[0]?.status).toBe("needs-access");
    expect(readout.overrides[0]?.missing).toEqual(["*://*.api.example.com/*"]);
    expect(readout.needsAccess).toBe(1);
    expect(readout.total).toBe(0);
  });

  it.each([
    ["live", GRANTED, LIVE],
    ["needs-access", NONE, LIVE],
    ["paused", GRANTED, PAUSED],
  ] as const)(
    "keeps a %s this-tab authorization change in the removable strip",
    (expectedStatus, grants, status) => {
      const readout = computeReadout({
        ...base,
        grants,
        status,
        activeProfile: profile(),
        overrides: [
          override({ header: "authorization", value: "Bearer secret" }),
        ],
      });

      expect(readout.token).toBeUndefined();
      expect(readout.overrides[0]?.status).toBe(expectedStatus);
      expect(readout.overrides[0]?.source).toBe("override");
    },
  );

  it("reports missing access rather than holding a paused this-tab change", () => {
    const readout = computeReadout({
      ...base,
      grants: NONE,
      status: PAUSED,
      activeProfile: profile(),
      overrides: [override()],
    });

    expect(readout.overrides[0]?.status).toBe("needs-access");
    expect(readout.overrides[0]?.held).toBe(true);
    expect(readout.needsAccess).toBe(1);
    expect(readout.held).toBe(0);
  });

  it("keeps an ungranted stored rule held while paused", () => {
    const readout = computeReadout({
      ...base,
      grants: NONE,
      status: PAUSED,
      activeProfile: profile({ rules: [rule()] }),
    });

    expect(readout.request[0]?.status).toBe("paused");
    expect(readout.held).toBe(1);
    expect(readout.needsAccess).toBe(0);
  });

  it("keeps a this-tab override live under a parent-domain grant", () => {
    const readout = computeReadout({
      ...base,
      grants: {
        origins: ["*://*.example.com/*"],
        allSites: false,
      },
      activeProfile: profile(),
      overrides: [
        override(),
        override({ num: 2, originHost: "api.other.test" }),
      ],
    });

    expect(readout.overrides[0]?.status).toBe("live");
    expect(readout.overrides[0]?.missing).toBeUndefined();
    expect(readout.overrides[1]?.status).toBe("needs-access");
    expect(readout.total).toBe(1);
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
    expect(readout.total).toBe(0);
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

  it("resolves collisions over the narrowed rules the compiler installs", () => {
    // A domains rule granted on only one of its sites is installed there, at full
    // priority, narrowed to that site: on this host it shadows a lower rule for
    // the same header exactly as it does on the wire. Its own row still reads
    // needs-access for the site it is missing.
    const partly = rule({
      scope: { type: "domains", domains: ["api.example.com", "other.test"] },
    });
    const lower = rule({ value: "prod" });
    const readout = computeReadout({
      ...base,
      grants: { origins: ["*://*.api.example.com/*"], allSites: false },
      activeProfile: profile({ rules: [partly, lower] }),
    });

    expect(
      readout.request.find((change) => change.ruleId === partly.id)?.status,
    ).toBe("needs-access");
    expect(
      readout.request.find((change) => change.ruleId === lower.id)?.status,
    ).toBe("overridden");
    expect(readout.overridden).toBe(1);
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
    expect(readout.total).toBe(0);
    // The hero is the loudest live claim in the popup; it may not be made.
    expect(readout.token).toBeUndefined();
  });

  it("drops a pattern rule whose host list excludes this tab", () => {
    // Grant-on-hosts compiles to requestDomains, a filter Chrome cannot match
    // outside those hosts, so a tab that is not under them sees no change even
    // when the pattern itself is unanchored and all sites are granted.
    const readout = computeReadout({
      ...base,
      grants: GRANTED,
      activeProfile: profile({
        rules: [
          rule({
            scope: { type: "pattern", pattern: "*", hosts: ["other.test"] },
          }),
        ],
      }),
    });
    expect(readout.request).toEqual([]);
    expect(readout.total).toBe(0);
    expect(readout.unconfirmed).toBe(0);
  });

  it("reports a pattern rule's reach from its host list, not as broad", () => {
    // Grant-on-hosts narrows the match to those hosts, so the line states the
    // bounded reach the compiled condition carries rather than "every site".
    const readout = computeReadout({
      ...base,
      grants: GRANTED,
      activeProfile: profile({
        rules: [
          rule({
            scope: {
              type: "pattern",
              pattern: "*",
              hosts: ["api.example.com", "other.test"],
            },
          }),
        ],
      }),
    });
    expect(readout.request[0]?.widerReach).toBe(1);
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
    expectSingleUnconfirmed(readout);
  });

  it("includes cross-origin requests initiated by the current tab", () => {
    const readout = computeReadout({
      ...base,
      host: "mysite.com",
      activeProfile: profile({
        rules: [
          rule({
            scope: {
              type: "domains",
              domains: ["api.example.com"],
            },
            resourceTypes: ["xhr"],
            initiators: ["mysite.com"],
          }),
        ],
      }),
    });

    expectSingleUnconfirmed(readout);
  });

  const hostlessRegexProfile = () =>
    profile({
      rules: [
        rule({ scope: { type: "regex", regex: "^https://x/", hosts: [] } }),
      ],
    });

  it("declines to claim a regex rule matches this tab, however broad its grant", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: hostlessRegexProfile(),
    });
    expect(readout.request[0]?.status).toBe("unconfirmed");
  });

  it("asks for broad access when a hostless regex rule needs a grant", () => {
    const readout = computeReadout({
      ...base,
      grants: NONE,
      activeProfile: hostlessRegexProfile(),
    });
    expect(readout.request[0]?.status).toBe("needs-access");
    expect(readout.request[0]?.missing).toEqual(["*://*/*"]);
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
    expect(readout.total).toBe(0);
  });

  it("leaves a this-tab authorization change in the temporary strip", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile(),
      overrides: [
        override({ num: 7, header: "authorization", value: "Bearer swapped" }),
        override({ num: 8, header: "x-flag", value: "1" }),
      ],
    });
    expect(readout.token).toBeUndefined();
    expect(readout.overrides.map((o) => o.overrideNum)).toEqual([7, 8]);
  });

  it("excludes an override-only reconcile failure from the headline", () => {
    const readout = computeReadout({
      ...base,
      activeProfile: profile(),
      overrides: [override()],
      status: OUT_OF_SYNC,
    });
    expect(readout.total).toBe(0);
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
    expect(previewSwitch(profile(), profile(), undefined)).toEqual({
      drops: [],
      adds: [],
    });
  });
});
