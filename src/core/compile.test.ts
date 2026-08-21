import { describe, expect, it } from "vitest";
import {
  compile as compileCore,
  compileDynamic,
  compileSession,
  type DnrRule,
  DYNAMIC_PRIORITY_TOP,
  dropInapplicable,
  emitRules,
  revisionOf,
  SESSION_PRIORITY_TOP,
  uncompilableReason,
} from "./compile";
import type { GrantSnapshot } from "./grants";
import {
  checkEnabledRuleLimits,
  MAX_DYNAMIC_RULES,
  MAX_ENABLED_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "./limits";
import type { HeaderOp, Profile, Rule, StateDoc, TabOverride } from "./model";
import { DNR_RESOURCE_TYPES, originPatternForDomain } from "./scope";
import { overrideKey, ruleKey } from "./verdict";

type RuleChanges = Omit<Partial<Rule>, "value"> & {
  value?: string | undefined;
};

function storedRule(num: number, changes: RuleChanges = {}): Rule {
  const { value, ...fields } = changes;
  const operation = fields.operation ?? "set";
  return {
    id: `rule-${num}`,
    num,
    direction: "request",
    operation,
    header: "x-debug",
    ...(operation === "remove" ? {} : { value: value ?? "on" }),
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...fields,
  };
}

function profile(id: string, rules: Rule[]): Profile {
  return {
    id,
    name: id,
    badgeText: id.slice(0, 2),
    color: "blue",
    rules,
  };
}

function state(
  profiles: Profile[],
  paused = false,
  activeProfileId = profiles[0]?.id ?? "",
): StateDoc {
  return {
    v: 1,
    profiles,
    activeProfileId,
    nextRuleNum: 20_000,
    settings: { paused, theme: "system" },
  };
}

function sessionOverride(num: number): TabOverride {
  return {
    num,
    tabId: num + 100,
    originHost: `host-${num}.example`,
    direction: "request",
    operation: "set",
    header: "x-session",
    value: `${num}`,
    enabled: true,
  };
}

function goldenRequestRule(
  id: number,
  priority: number,
  header: string,
  value: string,
  condition: DnrRule["condition"],
): DnrRule {
  return {
    id,
    priority,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header, operation: "set", value }],
    },
    condition,
  };
}

const ALL_SITES: GrantSnapshot = { origins: [], allSites: true };
const granting = (...domains: string[]): GrantSnapshot => ({
  origins: domains.map(originPatternForDomain),
  allSites: false,
});
const supportAll = () => true;

function compiledNarrowedAppendRule(
  domains: string[],
  origins: string[],
): DnrRule[] {
  const doc = state([
    profile("overlap", [
      storedRule(1, {
        header: "accept",
        operation: "append",
        scope: { type: "domains", domains },
      }),
    ]),
  ]);
  return compileDynamic(
    dropInapplicable(doc, supportAll, { origins, allSites: false }),
  );
}

function expectNarrowedToSubdomain(compiled: DnrRule[]): void {
  expect(compiled).toHaveLength(1);
  expect(compiled[0]?.condition).toEqual(
    expect.objectContaining({ requestDomains: ["sub.example.com"] }),
  );
  expect(compiled[0]?.condition.urlFilter).toBeUndefined();
}

function placementKeys(batch: ReturnType<typeof compileCore>): string[] {
  return batch.entries.flatMap((entry) =>
    entry.standing.kind === "placed"
      ? entry.standing.placements.map(
          (placement) => `${placement.band}:${placement.dnrId}`,
        )
      : [],
  );
}

function compile(
  input: Parameters<typeof compileCore>[0],
): ReturnType<typeof compileCore> {
  const batch = compileCore(input);
  expect({
    dynamic: batch.dynamic,
    session: batch.session,
  }).toEqual(emitRules(input));
  if (batch.paused) {
    expect(batch.dynamic).toEqual([]);
    expect(batch.session).toEqual([]);
    return batch;
  }
  const emitted = [
    ...batch.dynamic.map((rule) => `dynamic:${rule.id}`),
    ...batch.session.map((rule) => `session:${rule.id}`),
  ];
  const placed = placementKeys(batch);
  expect(placed.toSorted()).toEqual(emitted.toSorted());
  expect(new Set(placed).size).toBe(placed.length);
  return batch;
}

describe("batch compilation", () => {
  const doc = state([
    profile("active", [
      storedRule(1),
      storedRule(2, {
        scope: { type: "domains", domains: ["partial.test"] },
      }),
      storedRule(3, { enabled: false }),
      storedRule(4, { header: ":authority" }),
      storedRule(5, {
        scope: { type: "domains", domains: ["ungranted.test"] },
      }),
    ]),
    profile("inactive", [storedRule(6)]),
  ]);
  const overrides = [
    { ...sessionOverride(11), originHost: "example.com" },
    { ...sessionOverride(12), originHost: "partial.test" },
  ];
  const granted: GrantSnapshot = {
    origins: [
      "*://*.example.com/*",
      "https://partial.test/*",
      "http://partial.test:8080/*",
    ],
    allSites: false,
  };

  it("preserves the established dynamic and session rule text", () => {
    const batch = compile({
      doc,
      overrides,
      granted,
      isRegexSupported: () => true,
    });

    expect({ dynamic: batch.dynamic, session: batch.session }).toEqual({
      dynamic: [
        goldenRequestRule(1, 5_000, "x-debug", "on", {
          requestDomains: ["example.com"],
          resourceTypes: [...DNR_RESOURCE_TYPES],
        }),
        goldenRequestRule(2, 4_999, "x-debug", "on", {
          requestDomains: ["partial.test"],
          urlFilter: "|https://partial.test^",
          resourceTypes: [...DNR_RESOURCE_TYPES],
        }),
        goldenRequestRule(20_000, 4_998, "x-debug", "on", {
          requestDomains: ["partial.test"],
          urlFilter: "|http://partial.test:8080/",
          resourceTypes: [...DNR_RESOURCE_TYPES],
        }),
      ],
      session: [
        goldenRequestRule(11, 10_000, "x-session", "11", {
          tabIds: [111],
          requestDomains: ["example.com"],
          resourceTypes: [...DNR_RESOURCE_TYPES],
        }),
        goldenRequestRule(12, 9_999, "x-session", "12", {
          tabIds: [112],
          requestDomains: ["partial.test"],
          urlFilter: "|https://partial.test^",
          resourceTypes: [...DNR_RESOURCE_TYPES],
        }),
        goldenRequestRule(13, 9_998, "x-session", "12", {
          tabIds: [112],
          requestDomains: ["partial.test"],
          urlFilter: "|http://partial.test:8080/",
          resourceTypes: [...DNR_RESOURCE_TYPES],
        }),
      ],
    });
  });

  it("keeps a one-to-one relationship between rules and placements", () => {
    const batch = compile({
      doc,
      overrides,
      granted,
      isRegexSupported: () => true,
    });
    const slotted = [...batch.slots].flatMap(([slot, refs]) =>
      refs.map((ref) => ({
        slot,
        key: ref.key,
        operation: ref.operation,
        placement: ref.placement,
      })),
    );
    const expectedSlots = batch.entries.flatMap((entry) =>
      entry.standing.kind === "placed"
        ? entry.standing.placements.map((placement) => ({
            slot: `${entry.stage}:${entry.headerKey}`,
            key: entry.key,
            operation: entry.operation,
            placement,
          }))
        : [],
    );
    expect(slotted).toHaveLength(placementKeys(batch).length);
    expect(slotted.map((value) => JSON.stringify(value)).toSorted()).toEqual(
      expectedSlots.map((value) => JSON.stringify(value)).toSorted(),
    );
    for (const refs of batch.slots.values()) {
      expect(refs.map((ref) => ref.placement.priority)).toEqual(
        refs
          .map((ref) => ref.placement.priority)
          .toSorted((left, right) => right - left),
      );
    }
  });

  it("records authored metadata, absent reasons, and narrowed placements", () => {
    const batch = compile({
      doc,
      overrides,
      granted,
      isRegexSupported: () => true,
    });
    const standings = new Map(
      batch.entries.map((entry) => [entry.key, entry.standing]),
    );

    expect(standings.get(ruleKey("active", "rule-1", 0))).toMatchObject({
      kind: "placed",
      placements: [{ narrowed: false }],
    });
    expect(standings.get(ruleKey("active", "rule-2", 0))).toMatchObject({
      kind: "placed",
      placements: [{ narrowed: true }, { narrowed: true }],
    });
    expect(standings.get(ruleKey("active", "rule-3", 0))).toEqual({
      kind: "absent",
      reason: { kind: "off" },
    });
    expect(standings.get(ruleKey("active", "rule-4", 0))).toEqual({
      kind: "absent",
      reason: { kind: "refused", reason: "header" },
    });
    expect(standings.get(ruleKey("active", "rule-5", 0))).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted",
        missing: ["*://*.ungranted.test/*"],
      },
    });
    expect(standings.get(ruleKey("inactive", "rule-6", 0))).toEqual({
      kind: "absent",
      reason: { kind: "other-profile", profileName: "inactive" },
    });
    expect(standings.get(overrideKey(11, 0))).toMatchObject({
      kind: "placed",
      placements: [{ narrowed: false }],
    });
    expect(standings.get(overrideKey(12, 0))).toMatchObject({
      kind: "placed",
      placements: [{ narrowed: true }, { narrowed: true }],
    });
    expect(batch.entries[0]).toMatchObject({
      key: ruleKey("active", "rule-1", 0),
      profileId: "active",
      label: "x-debug rule",
      stage: "request",
      headerKey: "x-debug",
      header: "x-debug",
      operation: "set",
      authored: { requestDomains: ["example.com"] },
    });
  });

  it("records entry and slot fields from authored rules", () => {
    const batch = compile({
      doc: state([
        profile("active", [
          storedRule(1, {
            comment: "response trace",
            direction: "response",
            operation: "append",
            header: "X-Trace",
            resourceTypes: ["websockets"],
          }),
        ]),
      ]),
      overrides: [],
      granted: ALL_SITES,
      isRegexSupported: () => true,
    });

    expect(batch.entries).toEqual([
      {
        key: ruleKey("active", "rule-1", 0),
        profileId: "active",
        label: "response trace",
        stage: "response",
        headerKey: "x-trace",
        header: "X-Trace",
        operation: "append",
        authored: {
          requestDomains: ["example.com"],
          resourceTypes: ["websocket"],
        },
        standing: {
          kind: "placed",
          placements: [
            {
              dnrId: 1,
              band: "dynamic",
              priority: DYNAMIC_PRIORITY_TOP,
              condition: {
                requestDomains: ["example.com"],
                resourceTypes: ["websocket"],
              },
              narrowed: false,
              tabId: undefined,
            },
          ],
        },
        grantGap: undefined,
      },
    ]);
    expect(batch.slots.get("response:x-trace")).toEqual([
      {
        key: ruleKey("active", "rule-1", 0),
        operation: "append",
        placement:
          batch.entries[0]?.standing.kind === "placed"
            ? batch.entries[0].standing.placements[0]
            : undefined,
      },
    ]);
    expect(batch.slots.has("request:X-Trace")).toBe(false);
    expect(batch.entries[0]?.standing.kind).toBe("placed");
    if (batch.entries[0]?.standing.kind === "placed") {
      expect(batch.entries[0].standing.placements[0]?.condition).not.toBe(
        batch.dynamic[0]?.condition,
      );
    }
  });

  it("distinguishes missing target and initiator grants", () => {
    const initiatorRule = storedRule(1, {
      initiators: ["initiator.test"],
      resourceTypes: ["xhr"],
    });
    const compileWith = (granted: GrantSnapshot) =>
      compile({
        doc: state([profile("active", [initiatorRule])]),
        overrides: [],
        granted,
        isRegexSupported: () => true,
      }).entries[0]?.standing;

    expect(compileWith(granting("example.com"))).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted-initiator",
        missing: ["*://*.initiator.test/*"],
      },
    });
    expect(compileWith(granting("initiator.test"))).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted",
        missing: ["*://*.example.com/*"],
      },
    });
    expect(
      compile({
        doc: state([profile("active", [])]),
        overrides: [{ ...sessionOverride(1), originHost: "127.0.0.1" }],
        granted: granting(),
        isRegexSupported: () => true,
      }).entries[0]?.standing,
    ).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted",
        missing: ["*://127.0.0.1/*"],
      },
    });
  });

  it("records override metadata and tab placement", () => {
    const batch = compile({
      doc: state([profile("active", [])]),
      overrides: [
        {
          num: 7,
          tabId: 42,
          originHost: "example.com",
          direction: "response",
          operation: "remove",
          header: "X-Override",
          enabled: true,
        },
      ],
      granted: ALL_SITES,
      isRegexSupported: () => true,
    });

    expect(batch.entries).toEqual([
      {
        key: overrideKey(7, 0),
        profileId: "active",
        label: "X-Override rule",
        stage: "response",
        headerKey: "x-override",
        header: "X-Override",
        operation: "remove",
        authored: {
          tabIds: [42],
          requestDomains: ["example.com"],
          resourceTypes: [...DNR_RESOURCE_TYPES],
        },
        standing: {
          kind: "placed",
          placements: [
            {
              dnrId: 7,
              band: "session",
              priority: SESSION_PRIORITY_TOP,
              condition: {
                tabIds: [42],
                requestDomains: ["example.com"],
                resourceTypes: [...DNR_RESOURCE_TYPES],
              },
              narrowed: false,
              tabId: 42,
            },
          ],
        },
        grantGap: undefined,
      },
    ]);
  });

  it("keeps placements distinct for duplicate stored and override ids", () => {
    const batch = compile({
      doc: state([
        profile("active", [
          storedRule(1, { id: "duplicate" }),
          storedRule(2, { id: "duplicate" }),
        ]),
      ]),
      overrides: [
        { ...sessionOverride(7), tabId: 41, originHost: "example.com" },
        { ...sessionOverride(7), tabId: 42, originHost: "example.com" },
      ],
      granted: ALL_SITES,
      isRegexSupported: () => true,
    });

    expect(
      batch.entries.map((entry) => [
        entry.key,
        entry.standing.kind === "placed"
          ? entry.standing.placements.map((placement) => [
              placement.dnrId,
              placement.tabId,
            ])
          : [],
      ]),
    ).toEqual([
      [ruleKey("active", "duplicate", 0), [[1, undefined]]],
      [ruleKey("active", "duplicate", 1), [[2, undefined]]],
      [overrideKey(7, 0), [[7, 41]]],
      [overrideKey(7, 1), [[8, 42]]],
    ]);
  });

  it("builds distinct keys for colon-bearing ids", () => {
    expect(ruleKey("a", "b:c", 0)).not.toBe(ruleKey("a:b", "c", 0));
  });

  it("holds both bands while retaining every standing and slot when paused", () => {
    const running = compile({
      doc,
      overrides,
      granted,
      isRegexSupported: () => true,
    });
    const paused = compile({
      doc: {
        ...doc,
        settings: { ...doc.settings, paused: true },
      },
      overrides,
      granted,
      isRegexSupported: () => true,
    });

    expect(paused.dynamic).toEqual([]);
    expect(paused.session).toEqual([]);
    expect(paused.entries.map(({ key, standing }) => [key, standing])).toEqual(
      running.entries.map(({ key, standing }) => [key, standing]),
    );
    expect(paused.slots).toEqual(running.slots);
  });

  it("compiles the maximum stored rules within one second", () => {
    const rules = Array.from({ length: MAX_ENABLED_RULES }, (_, index) =>
      storedRule(index + 1),
    );
    const started = performance.now();

    expect(
      compileCore({
        doc: state([profile("full", rules)]),
        overrides: [],
        granted: ALL_SITES,
        isRegexSupported: () => true,
      }).dynamic,
    ).toHaveLength(MAX_ENABLED_RULES);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("hashes rule bands while ignoring order within each band", async () => {
    const first = goldenRequestRule(1, 5_000, "x-first", "a", {
      resourceTypes: ["xmlhttprequest"],
    });
    const second = goldenRequestRule(2, 4_999, "x-second", "b", {
      resourceTypes: ["xmlhttprequest"],
    });

    expect(await revisionOf([first], [second])).not.toEqual(
      await revisionOf([first, second], []),
    );
    expect(await revisionOf([first, second], [])).toEqual(
      await revisionOf([second, first], []),
    );
  });

  it("distinguishes rulesets that collide under a 32-bit digest", async () => {
    const condition: DnrRule["condition"] = {
      requestDomains: ["example.com"],
      resourceTypes: ["main_frame"],
    };
    const first = goldenRequestRule(
      1,
      5_000,
      "x-collision",
      "d8wbavskvs",
      condition,
    );
    const second = goldenRequestRule(
      1,
      5_000,
      "x-collision",
      "1wzuny4hqf",
      condition,
    );

    expect(await revisionOf([first], [])).not.toEqual(
      await revisionOf([second], []),
    );
  });

  it("uses fixed-width revisions for both bands", async () => {
    const revision = await revisionOf([], []);
    expect(revision.dynamic).toHaveLength(44);
    expect(revision.session).toHaveLength(44);
  });
});

describe("dynamic rule compilation", () => {
  it("installs only Chrome's exact-origin subset under a toolbar grant", () => {
    const doc = state([profile("active", [storedRule(99)])]);
    const narrowed: GrantSnapshot = {
      origins: ["https://example.com/*"],
      allSites: false,
    };

    expect(compileDynamic(dropInapplicable(doc, () => true, narrowed))).toEqual(
      [
        expect.objectContaining({
          id: 99,
          condition: expect.objectContaining({
            requestDomains: ["example.com"],
            urlFilter: "|https://example.com^",
          }),
        }),
      ],
    );
  });

  it("matches the observed main-frame and cross-origin request rule shapes", () => {
    expect(
      compileDynamic(
        state([
          profile("main-frame", [
            storedRule(100, {
              header: "x-headershim-test",
              value: "verified",
              scope: { type: "domains", domains: ["localhost"] },
              resourceTypes: ["pages", "xhr"],
            }),
          ]),
        ]),
      ),
    ).toEqual([
      {
        id: 100,
        priority: 5_000,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "x-headershim-test",
              operation: "set",
              value: "verified",
            },
          ],
        },
        condition: {
          requestDomains: ["localhost"],
          resourceTypes: ["main_frame", "xmlhttprequest"],
        },
      },
    ]);

    expect(
      compileDynamic(
        state([
          profile("cross-origin", [
            storedRule(110, {
              header: "x-headershim-edge",
              value: "request-host-only",
              scope: { type: "domains", domains: ["127.0.0.1"] },
              resourceTypes: ["xhr"],
            }),
          ]),
        ]),
      ),
    ).toEqual([
      {
        id: 110,
        priority: 5_000,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "x-headershim-edge",
              operation: "set",
              value: "request-host-only",
            },
          ],
        },
        condition: {
          requestDomains: ["127.0.0.1"],
          resourceTypes: ["xmlhttprequest"],
        },
      },
    ]);
  });

  it("anchors Chrome's observed non-default-port grant", () => {
    const doc = state([
      profile("active", [
        storedRule(98, {
          scope: { type: "domains", domains: ["localhost"] },
        }),
      ]),
    ]);
    const narrowed: GrantSnapshot = {
      origins: ["http://localhost:55848/*"],
      allSites: false,
    };

    expect(
      compileDynamic(dropInapplicable(doc, () => true, narrowed))[0]?.condition,
    ).toMatchObject({
      requestDomains: ["localhost"],
      urlFilter: "|http://localhost:55848/",
    });
  });

  it("keeps stable ids while assigning distinct decreasing priorities from visible order", () => {
    const first = storedRule(41);
    const second = storedRule(73);
    const third = storedRule(105);
    const inserted = storedRule(900);
    const disabled = storedRule(901, { enabled: false });
    const arrangements = [
      state([profile("alpha", [first, second]), profile("beta", [third])]),
      state([
        profile("alpha", [inserted, first, disabled, second]),
        profile("beta", [third]),
      ]),
      state([profile("beta", [third]), profile("alpha", [second, first])]),
      state([
        profile("alpha", [first, { ...second, enabled: false }]),
        profile("beta", [third]),
      ]),
    ];

    for (const arrangement of arrangements) {
      const expectedIds =
        arrangement.profiles
          .find(
            (candidateProfile) =>
              candidateProfile.id === arrangement.activeProfileId,
          )
          ?.rules.filter((rule) => rule.enabled)
          .map((rule) => rule.num) ?? [];
      const compiled = compileDynamic(arrangement);

      expect(compiled.map((rule) => rule.id)).toEqual(expectedIds);
      expect(compiled.map((rule) => rule.priority)).toEqual(
        expectedIds.map((_, index) => DYNAMIC_PRIORITY_TOP - index),
      );
      expect(new Set(compiled.map((rule) => rule.priority)).size).toBe(
        compiled.length,
      );
    }
  });

  it("applies higher priorities first, admits only later appends, stops after remove, and separates request from response", () => {
    const requestRules = compileDynamic(
      state([
        profile("ordered", [
          storedRule(1, { operation: "set", value: "first" }),
          storedRule(2, { operation: "remove", value: undefined }),
          storedRule(3, { operation: "append", value: "second" }),
          storedRule(4, { operation: "set", value: "ignored" }),
          storedRule(5, { operation: "append", value: "third" }),
          storedRule(6, {
            direction: "response",
            operation: "remove",
            value: undefined,
          }),
        ]),
      ]),
    );

    expect(evaluateHeaderDirection(requestRules, "request")).toEqual([
      "set",
      "append",
      "append",
    ]);
    expect(evaluateHeaderDirection(requestRules, "response")).toEqual([
      "remove",
    ]);

    const appendFirst = compileDynamic(
      state([
        profile("append-first", [
          storedRule(11, { operation: "append" }),
          storedRule(12, { operation: "set" }),
          storedRule(13, { operation: "append" }),
          storedRule(14, { operation: "remove" }),
        ]),
      ]),
    );
    expect(evaluateHeaderDirection(appendFirst, "request")).toEqual([
      "append",
      "append",
    ]);

    const removeFirst = compileDynamic(
      state([
        profile("remove-first", [
          storedRule(21, { operation: "remove", value: undefined }),
          storedRule(22, { operation: "append" }),
          storedRule(23, { operation: "set" }),
        ]),
      ]),
    );
    expect(evaluateHeaderDirection(removeFirst, "request")).toEqual(["remove"]);
  });

  it("compiles every scope and response operation without changing stored values", () => {
    const rules = [
      storedRule(1, {
        scope: {
          type: "pattern",
          pattern: "||example.com^",
          hosts: ["example.com"],
        },
        resourceTypes: ["scripts"],
        initiators: ["app.example.com"],
      }),
      storedRule(2, {
        scope: {
          type: "regex",
          regex: "^https://api\\.example\\.com/",
          hosts: ["api.example.com"],
        },
        resourceTypes: ["xhr"],
      }),
      storedRule(3, {
        direction: "response",
        operation: "remove",
        header: "server",
        value: undefined,
        scope: { type: "all" },
      }),
    ];

    expect(compileDynamic(state([profile("scopes", rules)]))).toEqual([
      {
        id: 1,
        priority: 5_000,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "x-debug", operation: "set", value: "on" },
          ],
        },
        condition: {
          requestDomains: ["example.com"],
          urlFilter: "||example.com^",
          initiatorDomains: ["app.example.com"],
          resourceTypes: ["script"],
        },
      },
      {
        id: 2,
        priority: 4_999,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "x-debug", operation: "set", value: "on" },
          ],
        },
        condition: {
          requestDomains: ["api.example.com"],
          regexFilter: "^https://api\\.example\\.com/",
          resourceTypes: ["xmlhttprequest"],
        },
      },
      {
        id: 3,
        priority: 4_998,
        action: {
          type: "modifyHeaders",
          responseHeaders: [{ header: "server", operation: "remove" }],
        },
        condition: { resourceTypes: DNR_RESOURCE_TYPES },
      },
    ]);
    expect(rules[0]?.initiators).toEqual(["app.example.com"]);
  });

  it("compiles paused, disabled-profile, and disabled-rule inputs to no rules", () => {
    expect(
      compileDynamic(state([profile("paused", [storedRule(1)])], true)),
    ).toEqual([]);
    expect(
      compileDynamic(
        state([profile("profile-off", [storedRule(2)])], false, "missing"),
      ),
    ).toEqual([]);
    expect(
      compileDynamic(
        state([profile("rule-off", [storedRule(3, { enabled: false })])]),
      ),
    ).toEqual([]);
    expect(compileSession([sessionOverride(1)], true, ALL_SITES)).toEqual([]);
  });

  it("reports dynamic and regex rule counts above their compile limits", () => {
    const atLimit = Array.from({ length: MAX_ENABLED_RULES }, (_, index) =>
      storedRule(index + 1),
    );
    const compiled = compileDynamic(state([profile("full", atLimit)]));

    expect(compiled).toHaveLength(MAX_ENABLED_RULES);
    expect(compiled.at(-1)?.priority).toBe(
      DYNAMIC_PRIORITY_TOP - MAX_ENABLED_RULES + 1,
    );
    const dynamicOverflowDoc = state([
      profile("overflow", [
        ...Array.from({ length: MAX_DYNAMIC_RULES + 1 }, (_, index) =>
          storedRule(index + 1),
        ),
        storedRule(MAX_DYNAMIC_RULES + 2, { header: "bad header" }),
        storedRule(MAX_DYNAMIC_RULES + 3, {
          scope: { type: "domains", domains: ["ungranted.test"] },
        }),
      ]),
    ]);
    expect(compileDynamic(dynamicOverflowDoc)).toHaveLength(MAX_DYNAMIC_RULES);
    const dynamicOverflow = compile({
      doc: dynamicOverflowDoc,
      overrides: [],
      granted: granting("example.com"),
      isRegexSupported: () => true,
    });
    expect(dynamicOverflow.dynamic).toHaveLength(MAX_DYNAMIC_RULES);
    expect(
      dynamicOverflow.entries
        .slice(0, MAX_DYNAMIC_RULES)
        .every((entry) => entry.standing.kind === "placed"),
    ).toBe(true);
    expect(dynamicOverflow.entries.at(-3)?.standing).toEqual({
      kind: "absent",
      reason: { kind: "over-limit", limit: "dynamic" },
    });
    expect(dynamicOverflow.entries.at(-2)?.standing).toEqual({
      kind: "absent",
      reason: { kind: "refused", reason: "header" },
    });
    expect(dynamicOverflow.entries.at(-1)?.standing).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted",
        missing: [originPatternForDomain("ungranted.test")],
      },
    });

    const regexRules = Array.from({ length: MAX_REGEX_RULES + 1 }, (_, index) =>
      storedRule(index + 1, {
        scope: {
          type: "regex",
          regex: `^https://host-${index}\\.example/`,
          hosts: [`host-${index}.example`],
        },
      }),
    );
    const regexOverflow = compile({
      doc: state([
        profile("regex-overflow", [
          ...regexRules,
          storedRule(MAX_REGEX_RULES + 2),
        ]),
      ]),
      overrides: [],
      granted: ALL_SITES,
      isRegexSupported: () => true,
    });
    expect(regexOverflow.dynamic).toHaveLength(MAX_REGEX_RULES + 1);
    expect(
      compileDynamic(
        state([
          profile("regex-overflow", [
            ...regexRules,
            storedRule(MAX_REGEX_RULES + 2),
          ]),
        ]),
      ),
    ).toEqual(regexOverflow.dynamic);
    expect(
      regexOverflow.entries
        .slice(0, MAX_REGEX_RULES)
        .every((entry) => entry.standing.kind === "placed"),
    ).toBe(true);
    expect(regexOverflow.entries.at(-2)?.standing).toEqual({
      kind: "absent",
      reason: { kind: "over-limit", limit: "regex" },
    });
    expect(regexOverflow.entries.at(-1)?.standing.kind).toBe("placed");

    const pausedOverflow = compile({
      doc: {
        ...dynamicOverflowDoc,
        settings: { theme: "system", paused: true },
      },
      overrides: [],
      granted: granting("example.com"),
      isRegexSupported: () => true,
    });
    expect(pausedOverflow.dynamic).toEqual([]);
    expect(pausedOverflow.entries).toEqual(dynamicOverflow.entries);
  });
});

describe("dropping inapplicable rules", () => {
  const compiledIds = (
    doc: StateDoc,
    supported: (regex: string) => boolean,
    granted: GrantSnapshot = ALL_SITES,
  ) =>
    compileDynamic(dropInapplicable(doc, supported, granted)).map(
      (rule) => rule.id,
    );

  // Chrome applies whatever is installed to any host it has access to, and
  // invoking the action hands it activeTab access to that tab. A rule the user
  // has not granted is therefore only safe while it is absent from the ruleset.
  it("compiles an ungranted rule to nothing, and compiles it once granted", () => {
    const doc = state([
      profile("scoped", [
        storedRule(1, {
          scope: { type: "domains", domains: ["example.com"] },
        }),
        storedRule(2, {
          scope: { type: "domains", domains: ["other.example"] },
        }),
      ]),
    ]);

    expect(compiledIds(doc, supportAll, granting())).toEqual([]);
    expect(compiledIds(doc, supportAll, granting("example.com"))).toEqual([1]);
    expect(
      compiledIds(doc, supportAll, granting("example.com", "other.example")),
    ).toEqual([1, 2]);
    expect(compiledIds(doc, supportAll, ALL_SITES)).toEqual([1, 2]);
    // Revoking is the same statement read the other way: the grant goes, the
    // rule leaves the ruleset with it.
    expect(compiledIds(doc, supportAll, granting("other.example"))).toEqual([
      2,
    ]);
  });

  it("holds a rule out until every origin it needs is granted", () => {
    // A subresource rule needs its initiator granted too, so a half grant is
    // still no grant.
    const doc = state([
      profile("initiator", [
        storedRule(1, {
          scope: { type: "domains", domains: ["api.example"] },
          resourceTypes: ["xhr"],
          initiators: ["app.example"],
        }),
      ]),
    ]);

    expect(compiledIds(doc, supportAll, granting("api.example"))).toEqual([]);
    expect(
      compiledIds(doc, supportAll, granting("api.example", "app.example")),
    ).toEqual([1]);
  });

  it("holds a broad-scope rule out until all-sites is granted", () => {
    const doc = state([
      profile("broad", [storedRule(1, { scope: { type: "all" } })]),
    ]);

    expect(compiledIds(doc, supportAll, granting("example.com"))).toEqual([]);
    expect(compiledIds(doc, supportAll, ALL_SITES)).toEqual([1]);
  });

  it("holds hostless matchers out until all-sites is granted", () => {
    const doc = state([
      profile("hostless", [
        storedRule(1, {
          scope: {
            type: "pattern",
            pattern: "||example.com^",
            hosts: [],
          },
        }),
        storedRule(2, {
          scope: {
            type: "regex",
            regex: "^https://example\\.com/",
            hosts: [],
          },
        }),
      ]),
    ]);

    expect(compiledIds(doc, supportAll, granting("example.com"))).toEqual([]);
    expect(compiledIds(doc, supportAll, ALL_SITES)).toEqual([1, 2]);
  });

  it("narrows a partly granted domains rule to the granted domains", () => {
    // Revoking one site of a multi-site rule must not silence it on the sites
    // still granted: the rule stays, scoped to what the user allowed.
    const doc = state([
      profile("multi", [
        storedRule(1, {
          scope: { type: "domains", domains: ["a.example", "b.example"] },
        }),
      ]),
    ]);
    const onA = compileDynamic(
      dropInapplicable(doc, supportAll, granting("a.example")),
    );
    expect(onA[0]?.condition.requestDomains).toEqual(["a.example"]);
    const onBoth = compileDynamic(
      dropInapplicable(doc, supportAll, granting("a.example", "b.example")),
    );
    expect(onBoth[0]?.condition.requestDomains).toEqual([
      "a.example",
      "b.example",
    ]);
    expect(compiledIds(doc, supportAll, granting())).toEqual([]);
  });

  it("compiles both a fully covered host and Chrome's exact-origin sibling", () => {
    const doc = state([
      profile("mixed-coverage", [
        storedRule(1, {
          scope: {
            type: "domains",
            domains: ["example.test", "example.com"],
          },
        }),
      ]),
    ]);
    const compiled = compileDynamic(
      dropInapplicable(doc, supportAll, {
        origins: ["*://*.example.test/*", "https://example.com/*"],
        allSites: false,
      }),
    );

    expect(compiled.map(({ condition }) => condition)).toEqual([
      expect.objectContaining({ requestDomains: ["example.test"] }),
      expect.objectContaining({
        requestDomains: ["example.com"],
        urlFilter: "|https://example.com^",
      }),
    ]);
  });

  it("does not duplicate a narrowed subset already covered by a full grant", () => {
    const doc = state([
      profile("covered-subset", [
        storedRule(1, {
          header: "accept",
          operation: "append",
          scope: { type: "domains", domains: ["example.test"] },
        }),
      ]),
    ]);
    const compiled = compileDynamic(
      dropInapplicable(doc, supportAll, {
        origins: ["*://*.example.test/*", "https://example.test/*"],
        allSites: false,
      }),
    );

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.condition).toEqual(
      expect.objectContaining({ requestDomains: ["example.test"] }),
    );
    expect(compiled[0]?.condition.urlFilter).toBeUndefined();
  });

  it("deduplicates a forward-nested full grant and no-filter narrowing", () => {
    expectNarrowedToSubdomain(
      compiledNarrowedAppendRule(
        ["example.com", "sub.example.com"],
        ["*://*.sub.example.com/*"],
      ),
    );
  });

  it("deduplicates a reverse-nested full grant and no-filter narrowing", () => {
    expectNarrowedToSubdomain(
      compiledNarrowedAppendRule(
        ["example.com", "api.sub.example.com"],
        ["*://*.sub.example.com/*"],
      ),
    );
  });

  it("keeps exact-origin overlap deduplicated", () => {
    const compiled = compiledNarrowedAppendRule(
      ["example.com", "sub.example.com"],
      ["https://sub.example.com/*"],
    );

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.condition).toEqual(
      expect.objectContaining({ requestDomains: ["sub.example.com"] }),
    );
    expect(compiled[0]?.condition.urlFilter).toBe("|https://sub.example.com^");
  });

  it("drops a ported anchor covered by a portless sibling from another domain", () => {
    const compiled = compiledNarrowedAppendRule(
      ["example.com", "a.b.example.com"],
      ["https://a.b.example.com:8443/*", "https://*.example.com/*"],
    );

    expect(compiled.map((rule) => rule.condition)).toEqual([
      expect.objectContaining({
        requestDomains: ["example.com"],
        urlFilter: "|https://example.com^",
      }),
      expect.objectContaining({
        requestDomains: ["a.b.example.com"],
        urlFilter: "|https://a.b.example.com^",
      }),
    ]);
  });

  it("counts a no-filter narrowing as placement for its contained domain", () => {
    const doc = state([
      profile("grant-gap", [
        storedRule(1, {
          scope: {
            type: "domains",
            domains: ["example.com", "api.sub.example.com"],
          },
        }),
      ]),
    ]);
    const batch = compile({
      doc,
      overrides: [],
      granted: { origins: ["*://*.sub.example.com/*"], allSites: false },
      isRegexSupported: supportAll,
    });

    expect(batch.entries[0]?.grantGap).toEqual({
      kind: "ungranted",
      missing: ["*://*.example.com/*"],
    });
  });

  it("drops a nested narrowing covered by a fully granted rule domain", () => {
    const compiled = compiledNarrowedAppendRule(
      ["example.com", "sub.example.com"],
      ["*://*.sub.example.com/*", "https://deep.sub.example.com/*"],
    );

    expectNarrowedToSubdomain(compiled);
  });

  it("drops a nested narrowing covered by a wider domain narrowing", () => {
    const compiled = compiledNarrowedAppendRule(
      ["example.com"],
      ["*://*.sub.example.com/*", "https://deep.sub.example.com/*"],
    );

    expectNarrowedToSubdomain(compiled);
  });

  it("keeps an extension-requested subdomain grant live for a parent-domain rule", () => {
    const doc = state([
      profile("parent", [
        storedRule(1, {
          scope: { type: "domains", domains: ["example.com"] },
        }),
      ]),
    ]);
    const compiled = compileDynamic(
      dropInapplicable(doc, supportAll, {
        origins: ["*://*.sub.example.com/*"],
        allSites: false,
      }),
    );

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.condition).toMatchObject({
      requestDomains: ["sub.example.com"],
    });
    expect(compiled[0]?.condition.urlFilter).toBeUndefined();
  });

  it("does not double-apply a fully granted child domain", () => {
    const doc = state([
      profile("covered-domains", [
        storedRule(1, {
          header: "accept",
          operation: "append",
          scope: {
            type: "domains",
            domains: ["example.com", "api.example.com"],
          },
        }),
      ]),
    ]);
    const compiled = compileDynamic(
      dropInapplicable(doc, supportAll, {
        origins: ["*://*.example.com/*"],
        allSites: false,
      }),
    );

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.condition).toMatchObject({
      requestDomains: ["example.com"],
    });
    expect(compiled[0]?.condition.urlFilter).toBeUndefined();
  });

  it("compiles every narrowed grant for one rule independent of grant order", () => {
    const doc = state([
      profile("multiple-grants", [
        storedRule(1, {
          scope: { type: "domains", domains: ["example.com"] },
        }),
      ]),
    ]);
    const grants = ["https://b.example.com/*", "https://a.example.com/*"];
    const compiled = compileDynamic(
      dropInapplicable(doc, supportAll, {
        origins: grants,
        allSites: false,
      }),
    );

    expect(compiled.map((rule) => rule.condition.urlFilter)).toEqual([
      "|https://b.example.com^",
      "|https://a.example.com^",
    ]);
    expect(
      compileDynamic(
        dropInapplicable(doc, supportAll, {
          origins: grants.toReversed(),
          allSites: false,
        }),
      ).map((rule) => rule.condition.urlFilter),
    ).toEqual(["|https://a.example.com^", "|https://b.example.com^"]);
  });

  it("compiles wildcard-scheme bare-host grants across both granted schemes", () => {
    const doc = state([
      profile("wildcard-scheme", [
        storedRule(1, {
          scope: { type: "domains", domains: ["example.com"] },
        }),
      ]),
    ]);
    const compiled = compileDynamic(
      dropInapplicable(doc, supportAll, {
        origins: ["*://example.com/*"],
        allSites: false,
      }),
    );

    expect(compiled.map((rule) => rule.condition.urlFilter)).toEqual([
      "|http://example.com^",
      "|https://example.com^",
    ]);
  });

  it("rejects an authored set whose grant projections could overflow Chrome", () => {
    const rules = Array.from({ length: MAX_ENABLED_RULES }, (_, index) =>
      storedRule(index + 1, {
        scope: {
          type: "domains",
          domains: ["example.test", "example.com"],
        },
      }),
    );
    expect(checkEnabledRuleLimits(rules)).toEqual({
      ok: false,
      error: {
        kind: "dynamic-rule-limit-exceeded",
        count: MAX_ENABLED_RULES * 2,
        limit: MAX_DYNAMIC_RULES,
      },
    });
  });

  it.each(["pattern", "regex"] as const)(
    "narrows a partly granted %s rule to its fully granted hosts",
    (type) => {
      const scope =
        type === "pattern"
          ? {
              type,
              pattern: "||api^",
              hosts: ["a.example", "b.example"],
            }
          : {
              type,
              regex: "^https://api/",
              hosts: ["a.example", "b.example"],
            };
      const doc = state([profile(type, [storedRule(1, { scope })])]);
      const compiled = compileDynamic(
        dropInapplicable(doc, supportAll, granting("a.example")),
      );

      expect(compiled[0]?.condition.requestDomains).toEqual(["a.example"]);
    },
  );

  it("strips only the enabled rules Chrome would reject, so the batch survives", () => {
    const nulRule = storedRule(2, { value: "a\0b" });
    const doc = state([
      profile("mixed", [
        storedRule(1),
        nulRule,
        storedRule(3, { header: ":authority" }),
        storedRule(4, {
          scope: { type: "pattern", pattern: "||exämple.com^", hosts: [] },
        }),
        storedRule(5, {
          scope: { type: "pattern", pattern: "||*", hosts: [] },
        }),
        storedRule(6, {
          scope: { type: "regex", regex: "^https://ok/", hosts: [] },
        }),
        storedRule(7, {
          scope: { type: "regex", regex: "(?=bad)", hosts: [] },
        }),
      ]),
    ]);

    const supported = (regex: string) => !regex.includes("(?=");
    expect(uncompilableReason(nulRule, supported)).toBe("value");
    expect(compiledIds(doc, supported)).toEqual([1, 6]);
  });

  it("strips a rule whose domains Chrome would refuse", () => {
    const doc = state([
      profile("domains", [
        storedRule(1, {
          scope: { type: "domains", domains: ["example.com", "a.example.com"] },
        }),
        // Chrome takes an entry like this verbatim, so dropping the rule would
        // break one that works today.
        storedRule(2, {
          scope: { type: "domains", domains: ["EXAMPLE.com:8080"] },
        }),
        storedRule(3, {
          scope: { type: "domains", domains: ["example.com", "exämple.com"] },
        }),
        // Chrome refuses an empty requestDomains list outright.
        storedRule(4, { scope: { type: "domains", domains: [] } }),
      ]),
    ]);

    expect(compiledIds(doc, supportAll)).toEqual([1, 2]);
  });

  it("strips non-ASCII regexes, scope hosts, and initiators", () => {
    const nonAsciiRegex = storedRule(2, {
      scope: { type: "regex", regex: "café", hosts: [] },
    });
    const nonAsciiHost = storedRule(3, {
      scope: {
        type: "pattern",
        pattern: "/api",
        hosts: ["café.example"],
      },
    });
    const nonAsciiInitiator = storedRule(4, {
      initiators: ["café.example"],
    });
    const doc = state([
      profile("ascii", [
        storedRule(1),
        nonAsciiRegex,
        nonAsciiHost,
        nonAsciiInitiator,
      ]),
    ]);

    expect(uncompilableReason(nonAsciiRegex, supportAll)).toBe("regex");
    expect(uncompilableReason(nonAsciiHost, supportAll)).toBe("domains");
    expect(uncompilableReason(nonAsciiInitiator, supportAll)).toBe("domains");
    expect(compiledIds(doc, supportAll)).toEqual([1]);
  });

  it("distinguishes and drops a disallowed request append", () => {
    const append = storedRule(2, {
      operation: "append",
      header: "content-type",
    });
    const doc = state([profile("append", [storedRule(1), append])]);

    expect(uncompilableReason(append, supportAll)).toBe("append");
    expect(
      uncompilableReason(storedRule(3, { header: ":authority" }), supportAll),
    ).toBe("header");
    expect(compiledIds(doc, supportAll)).toEqual([1]);
  });

  it("never removes disabled rules or touches disabled profiles", () => {
    const bad = storedRule(2, { enabled: false, value: "a\r\nb" });
    const doc = state([
      profile("on", [storedRule(1), bad]),
      profile("off", [storedRule(3, { header: ":authority" })]),
    ]);

    const dropped = dropInapplicable(doc, supportAll, ALL_SITES);
    expect(dropped.profiles[0]?.rules).toEqual([storedRule(1), bad]);
    expect(dropped.profiles[1]).toEqual(doc.profiles[1]);
    expect(compiledIds(doc, supportAll)).toEqual([1]);
  });
});

describe("session rule compilation", () => {
  it("confines every rule to its tab and host in the session priority band", () => {
    const overrides = Array.from(
      { length: MAX_SESSION_OVERRIDES },
      (_, index) => sessionOverride(index + 1),
    );
    const compiled = compileSession(overrides, false, ALL_SITES);

    expect(compiled).toHaveLength(MAX_SESSION_OVERRIDES);
    expect(compiled[0]?.priority).toBe(SESSION_PRIORITY_TOP);
    expect(compiled.at(-1)?.priority).toBe(9_001);
    expect(compiled.map((rule) => rule.priority)).toEqual(
      overrides.map((_, index) => SESSION_PRIORITY_TOP - index),
    );
    expect(
      compiled.every(
        (rule) =>
          rule.priority > DYNAMIC_PRIORITY_TOP &&
          rule.priority <= SESSION_PRIORITY_TOP,
      ),
    ).toBe(true);
    expect(new Set(compiled.map((rule) => rule.priority)).size).toBe(
      compiled.length,
    );
    for (const [index, rule] of compiled.entries()) {
      const override = overrides[index];
      if (override === undefined) {
        throw new Error("fixture must contain an override for every rule");
      }
      expect(rule.id).toBe(override.num);
      expect(rule.condition.tabIds).toEqual([override.tabId]);
      expect(rule.condition.requestDomains).toEqual([override.originHost]);
    }
  });

  it("reports a session rule count above its bounded priority band", () => {
    const overflowing = Array.from(
      { length: MAX_SESSION_OVERRIDES + 1 },
      (_, index) => sessionOverride(index + 1),
    );
    const disabled = {
      ...sessionOverride(MAX_SESSION_OVERRIDES + 2),
      enabled: false,
    };
    const ungranted = sessionOverride(MAX_SESSION_OVERRIDES + 3);
    const overrides = [...overflowing, disabled, ungranted];
    const granted = {
      origins: overflowing.map((override) =>
        originPatternForDomain(override.originHost),
      ),
      allSites: false,
    };
    const batch = compile({
      doc: state([profile("active", [])]),
      overrides,
      granted,
      isRegexSupported: () => true,
    });

    expect(batch.session).toHaveLength(MAX_SESSION_OVERRIDES);
    expect(compileSession(overrides, false, granted)).toHaveLength(
      MAX_SESSION_OVERRIDES,
    );
    expect(
      batch.entries
        .slice(0, MAX_SESSION_OVERRIDES)
        .every((entry) => entry.standing.kind === "placed"),
    ).toBe(true);
    expect(
      batch.entries
        .slice(MAX_SESSION_OVERRIDES, overflowing.length)
        .every(
          (entry) =>
            entry.standing.kind === "absent" &&
            entry.standing.reason.kind === "over-limit" &&
            entry.standing.reason.limit === "session",
        ),
    ).toBe(true);
    expect(batch.entries.at(-2)?.standing).toEqual({
      kind: "absent",
      reason: { kind: "off" },
    });
    expect(batch.entries.at(-1)?.standing).toEqual({
      kind: "absent",
      reason: {
        kind: "ungranted",
        missing: [
          originPatternForDomain(`host-${MAX_SESSION_OVERRIDES + 3}.example`),
        ],
      },
    });
  });

  // Same reason the stored ruleset is grant-filtered before compilation: the
  // action's activeTab grant makes any installed rule live on the tab it was
  // pinned to, so an ungranted row has to be absent, not merely tidied away.
  it("drops an override whose host is not granted", () => {
    expect(
      compileSession([sessionOverride(1)], false, granting("other.test")),
    ).toEqual([]);
  });

  it("confines an override to Chrome's exact-origin grant", () => {
    expect(
      compileSession([sessionOverride(1)], false, {
        origins: ["https://host-1.example/*"],
        allSites: false,
      })[0]?.condition,
    ).toMatchObject({
      requestDomains: ["host-1.example"],
      urlFilter: "|https://host-1.example^",
    });
  });

  it("compiles every narrowed origin held for one override", () => {
    const compiled = compileSession([sessionOverride(1)], false, {
      origins: ["https://host-1.example/*", "http://host-1.example:55848/*"],
      allSites: false,
    });

    expect(compiled.map((rule) => rule.id)).toEqual([1, 2]);
    expect(compiled.map((rule) => rule.condition.urlFilter)).toEqual([
      "|https://host-1.example^",
      "|http://host-1.example:55848/",
    ]);
  });

  it("deduplicates overlapping narrowed override grants", () => {
    const override = { ...sessionOverride(1), originHost: "example.com" };
    const compiled = compileSession([override], false, {
      origins: ["*://*.sub.example.com/*", "https://deep.sub.example.com/*"],
      allSites: false,
    });

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.condition).toMatchObject({
      requestDomains: ["sub.example.com"],
    });
  });

  it("keeps an override under a parent-domain grant", () => {
    const override = { ...sessionOverride(1), originHost: "api.example.com" };
    const compiled = compileSession([override], false, granting("example.com"));

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.condition.requestDomains).toEqual(["api.example.com"]);
  });

  it("confines an override to a granted subdomain", () => {
    const override = { ...sessionOverride(1), originHost: "example.com" };
    const granted = {
      origins: ["*://*.sub.example.com/*"],
      allSites: false,
    };
    const condition = compileSession([override], false, granted)[0]?.condition;

    expect(condition).toMatchObject({ requestDomains: ["sub.example.com"] });
    expect(condition?.urlFilter).toBeUndefined();
    expect(
      compile({
        doc: state([]),
        overrides: [override],
        granted,
        isRegexSupported: () => true,
      }).entries[0]?.standing,
    ).toMatchObject({ kind: "placed", placements: [{ narrowed: true }] });
  });

  it("keeps an override under all-sites access", () => {
    expect(compileSession([sessionOverride(1)], false, ALL_SITES)).toHaveLength(
      1,
    );
  });

  it("compiles the granted rows and drops the rest in one pass", () => {
    const granted = { ...sessionOverride(1), originHost: "api.example.com" };
    const ungranted = { ...sessionOverride(2), originHost: "api.other.test" };
    const compiled = compileSession(
      [granted, ungranted],
      false,
      granting("example.com"),
    );

    expect(compiled.map((rule) => rule.id)).toEqual([1]);
  });
});

describe("portable conditions", () => {
  it("never emits unsupported top-level or response-header condition keys", () => {
    const dynamic = compileDynamic(
      state([
        profile("portable", [
          storedRule(1, { scope: { type: "all" } }),
          storedRule(2, {
            direction: "response",
            scope: {
              type: "pattern",
              pattern: "||example.com^",
              hosts: ["example.com"],
            },
          }),
          storedRule(3, {
            scope: {
              type: "regex",
              regex: "example",
              hosts: ["example.com"],
            },
          }),
        ]),
      ]),
    );
    const compiled = [
      ...dynamic,
      ...compileSession([sessionOverride(4)], false, ALL_SITES),
    ];

    for (const rule of compiled) {
      expect(Object.keys(rule.condition)).not.toContain("topDomains");
      expect(Object.keys(rule.condition)).not.toContain("responseHeaders");
    }
  });
});

function evaluateHeaderDirection(
  rules: readonly DnrRule[],
  direction: "request" | "response",
): HeaderOp[] {
  const selected: HeaderOp[] = [];
  for (const rule of [...rules].sort(
    (left, right) => right.priority - left.priority,
  )) {
    const modification =
      direction === "request"
        ? rule.action.requestHeaders?.[0]
        : rule.action.responseHeaders?.[0];
    if (modification === undefined) {
      continue;
    }
    const first = selected[0];
    if (first === undefined) {
      selected.push(modification.operation);
    } else if (first !== "remove" && modification.operation === "append") {
      selected.push(modification.operation);
    }
  }
  return selected;
}
