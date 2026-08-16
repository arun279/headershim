import { describe, expect, expectTypeOf, it } from "vitest";
import { type Applied, confirm, type Projection } from "../../core/applied";
import type { GrantSnapshot } from "../../core/grants";
import { MAX_ENABLED_RULES } from "../../core/limits";
import type { Profile, Rule, StateDoc, TabOverride } from "../../core/model";
import { overrideKey, ruleKey } from "../../core/verdict";
import { copy } from "../copy";
import { confirmedBatch } from "../test/fixtures";
import type { TabContext } from "./project";
import { computeReadout, previewSwitch } from "./readout";

const TAB = {
  tabId: 41,
  host: "api.example.com",
  origin: "https://api.example.com",
} as const;

const ALL_SITES: GrantSnapshot = { origins: [], allSites: true };
const API_SITE: GrantSnapshot = {
  origins: ["*://*.api.example.com/*"],
  allSites: false,
};

type RuleChanges = Omit<Partial<Rule>, "id" | "num" | "value"> & {
  readonly value?: string | undefined;
};

function storedRule(id: string, num: number, changes: RuleChanges = {}): Rule {
  const { value, ...fields } = changes;
  const operation = fields.operation ?? "set";
  return {
    id,
    num,
    direction: "request",
    operation,
    header: "x-test",
    ...(operation === "remove" ? {} : { value: value ?? `value-${num}` }),
    scope: { type: "domains", domains: [TAB.host] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...fields,
  };
}

function activeProfile(rules: Rule[]): Profile {
  return {
    id: "default",
    name: "Default",
    badgeText: "DE",
    color: "indigo",
    rules,
  };
}

function otherProfile(rules: Rule[]): Profile {
  return {
    id: "other",
    name: "Other",
    badgeText: "OT",
    color: "slate",
    rules,
  };
}

function switchDoc(active: Rule[], target: Profile): StateDoc {
  return {
    ...state(active),
    profiles: [activeProfile(active), target],
  };
}

function state(rules: Rule[], paused = false): StateDoc {
  return {
    v: 1,
    profiles: [activeProfile(rules)],
    activeProfileId: "default",
    nextRuleNum: 100,
    settings: { paused, theme: "system" },
  };
}

function temporary(
  num: number,
  changes: Partial<TabOverride> = {},
): TabOverride {
  return {
    num,
    tabId: TAB.tabId,
    originHost: TAB.host,
    direction: "request",
    operation: "set",
    header: "x-temporary",
    value: `temporary-${num}`,
    enabled: true,
    ...changes,
  };
}

function appliedFor(
  doc: StateDoc,
  overrides: readonly TabOverride[] = [],
  granted: GrantSnapshot = ALL_SITES,
): Applied {
  return confirmedBatch({
    doc,
    overrides,
    granted,
    isRegexSupported: () => true,
  }).applied;
}

describe("computeReadout", () => {
  it("keeps a this-tab authorization change in the strip", () => {
    const saved = storedRule("saved-auth", 1, {
      header: "Authorization",
      value: "Bearer saved",
    });
    const override = temporary(90, {
      header: "authorization",
      value: "Bearer session",
    });
    const doc = state([saved]);
    const readout = computeReadout({
      applied: appliedFor(doc, [override]),
      doc,
      overrides: [override],
      tab: TAB,
    });

    expect(readout.token).toBeUndefined();
    expect(readout.request).toEqual([
      expect.objectContaining({
        key: ruleKey("default", "saved-auth", 0),
        source: "rule",
        ruleId: "saved-auth",
        display: "Bearer [hidden]",
        outcome: {
          kind: "shadowed",
          by: overrideKey(90, 0),
          label: "authorization rule",
        },
      }),
    ]);
    expect(readout.overrides.map((change) => change.key)).toEqual(["tab:90:0"]);
    expect(readout).toMatchObject({ total: 1, overridden: 1 });
  });

  it("summarizes projected outcomes and keeps absent reasons while paused", () => {
    const rules = [
      storedRule("running", 1, { header: "x-running" }),
      storedRule("conditional", 2, {
        header: "x-conditional",
        scope: {
          type: "pattern",
          pattern: "||api.example.com/",
          hosts: [TAB.host],
        },
      }),
      storedRule("winner", 3, { header: "x-collision" }),
      storedRule("shadowed", 4, { header: "x-collision" }),
      storedRule("refused", 5, { header: ":authority" }),
      storedRule("transport-caveat", 6, { header: "connection" }),
      storedRule("ungranted-initiator", 7, {
        header: "x-cross-origin",
        resourceTypes: ["xhr"],
        initiators: ["app.other.test"],
      }),
    ];
    const liveDoc = state(rules);
    const live = computeReadout({
      applied: appliedFor(liveDoc, [], API_SITE),
      doc: liveDoc,
      overrides: [],
      tab: TAB,
    });

    expect(live).toMatchObject({
      total: 3,
      held: 0,
      needsAccess: 1,
      refused: 1,
      transport: 1,
      overridden: 1,
      unconfirmed: 1,
    });

    const pausedDoc = state(rules, true);
    const paused = computeReadout({
      applied: appliedFor(pausedDoc, [], API_SITE),
      doc: pausedDoc,
      overrides: [],
      tab: TAB,
    });
    expect(paused).toMatchObject({
      total: 0,
      held: 3,
      needsAccess: 1,
      refused: 1,
      transport: 1,
      overridden: 1,
      unconfirmed: 1,
    });
  });

  it("counts a Host rule into the transport count, not as running", () => {
    const doc = state([storedRule("host-rule", 1, { header: "host" })]);
    const readout = computeReadout({
      applied: appliedFor(doc),
      doc,
      overrides: [],
      tab: TAB,
    });

    expect(readout).toMatchObject({ total: 0, transport: 1 });
  });

  // A rule Chrome settles per request AND whose header carries a transport
  // caveat is uncertain for one reason: the match. The transport count is not
  // where that belongs, since it would assert an effect the popup cannot know
  // ("takes effect on HTTP/1.1") for a rule that may never match at all; it
  // keeps the same place an uncaveated undecided rule would, and its own line
  // still carries the header's HTTP/2 behavior.
  it("counts a match-undecided caveated change as unconfirmed, not transport", () => {
    const doc = state([
      storedRule("conditional-caveat", 1, {
        header: "connection",
        scope: {
          type: "pattern",
          pattern: "||api.example.com/",
          hosts: [TAB.host],
        },
      }),
    ]);
    const readout = computeReadout({
      applied: appliedFor(doc),
      doc,
      overrides: [],
      tab: TAB,
    });

    expect(readout).toMatchObject({ total: 1, unconfirmed: 1, transport: 0 });
  });

  // The transport caveats are request-side measurements, so a response rule on
  // the same name counts as running and carries no caveat: silence, not an
  // unmeasured claim.
  it("keeps response-side rules out of the transport count", () => {
    const doc = state([
      storedRule("response-connection", 1, {
        direction: "response",
        header: "connection",
      }),
    ]);
    const readout = computeReadout({
      applied: appliedFor(doc),
      doc,
      overrides: [],
      tab: TAB,
    });

    expect(readout).toMatchObject({ total: 1, transport: 0 });
    expect(readout.response[0]?.caveats).toEqual([]);
  });

  it("does not count caveats from changes that cannot run", () => {
    const rules = [
      storedRule("disabled-transport", 1, {
        header: "connection",
        enabled: false,
      }),
      storedRule("refused-transport", 2, {
        header: "connection",
        value: "bad\r\nvalue",
      }),
      storedRule("disabled-security", 3, {
        direction: "response",
        header: "content-security-policy",
        enabled: false,
      }),
      storedRule("refused-security", 4, {
        direction: "response",
        header: "content-security-policy",
        value: "bad\r\nvalue",
      }),
    ];
    const doc = state(rules);
    const readout = computeReadout({
      applied: appliedFor(doc),
      doc,
      overrides: [],
      tab: TAB,
    });

    expect(readout).toMatchObject({
      total: 0,
      refused: 2,
      transport: 0,
      security: 0,
    });
  });

  it("uses authored values and generation metadata for display fields", () => {
    const generated = storedRule("generated", 1, {
      header: "X-Request-ID",
      value: "",
      generated: {
        kind: "uuid",
        at: "2026-07-12T14:03:00.000Z",
      },
    });
    const secret = storedRule("secret", 2, {
      header: "Proxy-Authorization",
      value: "Basic abc123",
    });
    const removed = storedRule("removed", 3, {
      direction: "response",
      operation: "remove",
      header: "X-Powered-By",
    });
    const doc = state([generated, secret, removed]);
    const readout = computeReadout({
      applied: appliedFor(doc),
      doc,
      overrides: [],
      tab: TAB,
    });

    expect(
      readout.request.find((change) => change.ruleId === generated.id),
    ).toMatchObject({
      profileId: "default",
      ruleId: "generated",
      direction: "request",
      operation: "set",
      header: "X-Request-ID",
      value: "",
      display: copy.rules.generated(copy.editor.generatedKind.uuid),
      secret: false,
      enabled: true,
      paused: false,
    });
    expect(
      readout.request.find((change) => change.ruleId === secret.id),
    ).toMatchObject({
      header: "Proxy-Authorization",
      value: "Basic abc123",
      display: "Basic [hidden]",
      secret: true,
    });
    expect(
      readout.response.find((change) => change.ruleId === removed.id),
    ).not.toHaveProperty("display");
  });

  it("omits rules that only reach another site", () => {
    const here = storedRule("here", 1, { header: "x-here" });
    const there = storedRule("there", 2, {
      header: "x-there",
      scope: { type: "domains", domains: ["other.example.com"] },
    });
    const doc = state([here, there]);

    const readout = computeReadout({
      applied: appliedFor(doc),
      doc,
      overrides: [],
      tab: TAB,
    });

    expect(readout.request.map((change) => change.header)).toEqual(["x-here"]);
    expect(readout.total).toBe(1);
  });

  it("selects the installed authorization placement for the token hero", () => {
    const ungranted = storedRule("ungranted", 1, {
      header: "authorization",
      value: "Bearer UNGRANTED",
      resourceTypes: ["xhr"],
      initiators: ["thirdparty.example"],
    });
    const installed = storedRule("installed", 2, {
      header: "authorization",
      value: "Bearer PLACED",
    });
    const doc = state([ungranted, installed]);

    const readout = computeReadout({
      applied: appliedFor(doc, [], API_SITE),
      doc,
      overrides: [],
      tab: TAB,
    });

    expect(readout.token).toMatchObject({
      ruleId: "installed",
      value: "Bearer PLACED",
      outcome: { kind: "runs" },
    });
  });
});

describe("previewSwitch", () => {
  it("requires regex support and overrides for every preview", () => {
    expectTypeOf<Parameters<typeof previewSwitch>>().toEqualTypeOf<
      [
        projection: Projection,
        targetProfile: Profile,
        tab: TabContext,
        granted: GrantSnapshot,
        isRegexSupported: (regex: string) => boolean,
        overrides: readonly TabOverride[],
      ]
    >();
  });

  it("shows the complete switch while the current batch is pending", () => {
    const active = storedRule("active", 1, { header: "authorization" });
    const target = otherProfile([
      storedRule("target", 2, { header: "x-target" }),
    ]);
    const applied = appliedFor({
      ...state([active]),
      profiles: [activeProfile([active]), target],
    });
    const live = confirm(
      applied.batch,
      { dynamic: "expected", session: "expected" },
      { dynamic: "stale", session: "stale" },
    );
    if (live.confirmation !== "pending")
      throw new Error("expected pending projection");

    expect(previewSwitch(live, target, TAB, ALL_SITES, () => true, [])).toEqual(
      {
        drops: ["authorization"],
        adds: [{ header: "x-target", display: "value-2" }],
      },
    );
  });

  it("does not report a persistent this-tab change as dropped", () => {
    const doc: StateDoc = {
      ...state([]),
      profiles: [activeProfile([]), otherProfile([])],
    };
    const override = temporary(90, { header: "x-tab-only" });
    const target = doc.profiles[1];
    if (target === undefined) throw new Error("missing target profile");

    expect(
      previewSwitch(
        appliedFor(doc, [override]),
        target,
        TAB,
        ALL_SITES,
        () => true,
        [],
      ),
    ).toEqual({
      drops: [],
      adds: [],
    });
  });

  it("does not preview a saved rule beneath a persistent this-tab change", () => {
    const override = temporary(90, { header: "x-target" });
    const target = otherProfile([
      storedRule("target", 2, { header: "x-target" }),
    ]);
    const doc: StateDoc = {
      ...state([]),
      profiles: [activeProfile([]), target],
    };

    expect(
      previewSwitch(
        appliedFor(doc, [override]),
        target,
        TAB,
        ALL_SITES,
        () => true,
        [override],
      ),
    ).toEqual({
      drops: [],
      adds: [],
    });
  });

  it("pairs a reachable target entry with its own value", () => {
    const target = otherProfile([
      storedRule("disabled", 2, {
        header: "x-disabled",
        value: "never",
        enabled: false,
      }),
      storedRule("reachable", 3, {
        header: "x-reachable",
        value: "real-value",
      }),
    ]);
    const doc: StateDoc = {
      ...state([storedRule("active", 1, { header: "x-active" })]),
      profiles: [
        activeProfile([storedRule("active", 1, { header: "x-active" })]),
        target,
      ],
    };

    expect(
      previewSwitch(appliedFor(doc), target, TAB, ALL_SITES, () => true, []),
    ).toEqual({
      drops: ["x-active"],
      adds: [{ header: "x-reachable", display: "real-value" }],
    });
  });

  it("does not preview a refused target switch", () => {
    const active = storedRule("active", 1, { header: "x-auth" });
    const target = otherProfile([
      storedRule("invalid", 2, {
        header: "x-auth",
        value: "invalid\r\nvalue",
      }),
    ]);
    const doc = switchDoc([active], target);

    expect(
      previewSwitch(appliedFor(doc), target, TAB, ALL_SITES, () => true, []),
    ).toEqual({
      drops: ["x-auth"],
      adds: [],
    });
  });

  it("keeps valid target changes when another target rule is refused", () => {
    const active = storedRule("active", 1, { header: "x-current" });
    const refusedRegex = "^https://unsupported\\.example\\.com/";
    const target = otherProfile([
      storedRule("valid", 2, { header: "x-valid" }),
      storedRule("refused", 3, {
        header: "x-refused",
        scope: {
          type: "regex",
          regex: refusedRegex,
          hosts: [TAB.host],
        },
      }),
    ]);
    const doc = switchDoc([active], target);

    expect(
      previewSwitch(
        appliedFor(doc),
        target,
        TAB,
        ALL_SITES,
        (regex) => regex !== refusedRegex,
        [],
      ),
    ).toEqual({
      drops: ["x-current"],
      adds: [{ header: "x-valid", display: "value-2" }],
    });
  });

  it("does not preview a target rule without site access", () => {
    const active = storedRule("active", 1, { header: "x-active" });
    const target = otherProfile([
      storedRule("target", 2, { header: "x-target" }),
    ]);
    const doc = switchDoc([active], target);

    expect(
      previewSwitch(
        appliedFor(doc),
        target,
        TAB,
        {
          origins: [],
          allSites: false,
        },
        () => true,
        [],
      ),
    ).toEqual({
      drops: ["x-active"],
      adds: [],
    });
  });

  it("uses target profile regex support in the preview", () => {
    const active = storedRule("active", 1, { header: "x-active" });
    const regex = "^https://api\\.example\\.com/";
    const target = otherProfile([
      storedRule("target", 2, {
        header: "x-target",
        scope: { type: "regex", regex, hosts: [TAB.host] },
      }),
    ]);
    const doc = switchDoc([active], target);

    expect(
      previewSwitch(
        appliedFor(doc),
        target,
        TAB,
        ALL_SITES,
        (candidate) => candidate === regex,
        [],
      ),
    ).toEqual({
      drops: ["x-active"],
      adds: [{ header: "x-target", display: "value-2" }],
    });
  });

  it("does not preview a target profile beyond the enabled limit", () => {
    const active = storedRule("active", 1, { header: "x-active" });
    const target = otherProfile([
      ...Array.from({ length: MAX_ENABLED_RULES }, (_, index) =>
        storedRule(`kept-${index}`, index + 2, { header: "x-kept" }),
      ),
      storedRule("overflow", MAX_ENABLED_RULES + 2, {
        header: "x-overflow",
      }),
    ]);
    const doc = switchDoc([active], target);

    const preview = previewSwitch(
      appliedFor(doc),
      target,
      TAB,
      ALL_SITES,
      () => true,
      [],
    );
    expect(preview).toEqual({ drops: [], adds: [] });
  });
});
