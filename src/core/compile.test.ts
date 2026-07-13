import { describe, expect, it } from "vitest";
import {
  compileDynamic,
  compileSession,
  type DnrRule,
  DYNAMIC_PRIORITY_TOP,
  SESSION_PRIORITY_TOP,
} from "./compile";
import {
  MAX_ENABLED_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "./limits";
import type { HeaderOp, Profile, Rule, StateDoc, TabOverride } from "./model";
import { DNR_RESOURCE_TYPES } from "./scope";

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

function profile(id: string, rules: Rule[], enabled = true): Profile {
  return {
    id,
    name: id,
    badgeText: id.slice(0, 2),
    color: "blue",
    enabled,
    rules,
  };
}

function state(profiles: Profile[], paused = false): StateDoc {
  return {
    v: 1,
    profiles,
    focusedProfileId: profiles[0]?.id ?? "",
    nextRuleNum: 20_000,
    settings: { paused, theme: "system", badgeMode: "count" },
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
  };
}

describe("dynamic rule compilation", () => {
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
      const expectedIds = arrangement.profiles.flatMap((candidateProfile) =>
        candidateProfile.enabled
          ? candidateProfile.rules
              .filter((rule) => rule.enabled)
              .map((rule) => rule.num)
          : [],
      );
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
      compileDynamic(state([profile("profile-off", [storedRule(2)], false)])),
    ).toEqual([]);
    expect(
      compileDynamic(
        state([profile("rule-off", [storedRule(3, { enabled: false })])]),
      ),
    ).toEqual([]);
    expect(compileSession([sessionOverride(1)], true)).toEqual([]);
  });

  it("rejects enabled and regex rule counts above their compile limits", () => {
    const atLimit = Array.from({ length: MAX_ENABLED_RULES }, (_, index) =>
      storedRule(index + 1),
    );
    const compiled = compileDynamic(state([profile("full", atLimit)]));

    expect(compiled).toHaveLength(MAX_ENABLED_RULES);
    expect(compiled.at(-1)?.priority).toBe(501);
    expect(() =>
      compileDynamic(
        state([
          profile("overflow", [...atLimit, storedRule(MAX_ENABLED_RULES + 1)]),
        ]),
      ),
    ).toThrow(RangeError);

    const regexRules = Array.from({ length: MAX_REGEX_RULES + 1 }, (_, index) =>
      storedRule(index + 1, {
        scope: {
          type: "regex",
          regex: `^https://host-${index}\\.example/`,
          hosts: [`host-${index}.example`],
        },
      }),
    );
    expect(() =>
      compileDynamic(state([profile("regex-overflow", regexRules)])),
    ).toThrow(RangeError);
  });
});

describe("session rule compilation", () => {
  it("confines every rule to its tab and host in the session priority band", () => {
    const overrides = Array.from(
      { length: MAX_SESSION_OVERRIDES },
      (_, index) => sessionOverride(index + 1),
    );
    const compiled = compileSession(overrides, false);

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

  it("rejects a session rule count above its bounded priority band", () => {
    expect(() =>
      compileSession(
        Array.from({ length: MAX_SESSION_OVERRIDES + 1 }, (_, index) =>
          sessionOverride(index + 1),
        ),
        false,
      ),
    ).toThrow(RangeError);
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
      ...compileSession([sessionOverride(4)], false),
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
