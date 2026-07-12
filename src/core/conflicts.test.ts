import { describe, expect, it } from "vitest";
import { findOverriddenRules } from "./conflicts";
import type { HeaderOp, Rule, Scope } from "./model";

function rule(
  id: string,
  scope: Scope,
  overrides: Partial<
    Pick<Rule, "direction" | "operation" | "header" | "enabled">
  > = {},
): Rule {
  return {
    id,
    num: Number(id.replace(/\D/g, "")),
    direction: "request",
    operation: "set",
    header: "x-debug",
    value: "on",
    scope,
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

function domains(...values: string[]): Scope {
  return { type: "domains", domains: values };
}

function expectShadowed(
  earlierScope: Scope,
  laterScope: Scope,
  earlierOperation: HeaderOp = "set",
): void {
  expect(
    findOverriddenRules([
      rule("rule-1", earlierScope, { operation: earlierOperation }),
      rule("rule-2", laterScope),
    ]),
  ).toEqual([{ ruleId: "rule-2", shadowedByRuleId: "rule-1" }]);
}

describe("findOverriddenRules", () => {
  it("detects parent-domain coverage of the complete later domain set", () => {
    expectShadowed(
      domains("example.com"),
      domains("api.example.com", "cdn.api.example.com"),
    );
  });

  it("detects equal domain sets", () => {
    expectShadowed(
      domains("example.net", "example.com"),
      domains("example.com", "example.net"),
    );
  });

  it("detects a strict domain-set superset", () => {
    expectShadowed(
      domains("example.net", "example.com"),
      domains("example.com"),
    );
  });

  it("does not treat partial domain-set coverage as overriding", () => {
    expect(
      findOverriddenRules([
        rule("rule-1", domains("example.com")),
        rule("rule-2", domains("api.example.com", "example.net")),
      ]),
    ).toEqual([]);
  });

  it("detects an all scope covering a later domains scope", () => {
    expectShadowed({ type: "all" }, domains("api.example.com"));
  });

  it("detects two all scopes", () => {
    expectShadowed({ type: "all" }, { type: "all" });
  });

  it("detects byte-identical patterns", () => {
    expectShadowed(
      {
        type: "pattern",
        pattern: "||example.com^",
        hosts: ["example.com"],
      },
      {
        type: "pattern",
        pattern: "||example.com^",
        hosts: ["api.example.com"],
      },
    );
  });

  it("detects byte-identical regular expressions", () => {
    expectShadowed(
      {
        type: "regex",
        regex: "^https://example\\.com/",
        hosts: ["example.com"],
      },
      {
        type: "regex",
        regex: "^https://example\\.com/",
        hosts: ["api.example.com"],
      },
    );
  });

  it("does not infer overlap between similar but non-identical patterns", () => {
    expect(
      findOverriddenRules([
        rule("rule-1", {
          type: "pattern",
          pattern: "||example.com^",
          hosts: ["example.com"],
        }),
        rule("rule-2", {
          type: "pattern",
          pattern: "||api.example.com^",
          hosts: ["api.example.com"],
        }),
      ]),
    ).toEqual([]);
  });

  it("does not infer overlap between similar but non-identical regular expressions", () => {
    expect(
      findOverriddenRules([
        rule("rule-1", {
          type: "regex",
          regex: "^https://(?:api\\.)?example\\.com/",
          hosts: ["example.com"],
        }),
        rule("rule-2", {
          type: "regex",
          regex: "^https://api\\.example\\.com/",
          hosts: ["api.example.com"],
        }),
      ]),
    ).toEqual([]);
  });

  it("does not infer overlap across unlisted scope-type pairs", () => {
    const scopes: readonly [Scope, Scope][] = [
      [
        {
          type: "pattern",
          pattern: "||example.com^",
          hosts: ["example.com"],
        },
        {
          type: "regex",
          regex: "^https://example\\.com/",
          hosts: ["example.com"],
        },
      ],
      [
        { type: "all" },
        {
          type: "pattern",
          pattern: "||example.com^",
          hosts: ["example.com"],
        },
      ],
      [domains("example.com"), { type: "all" }],
    ];

    for (const [earlier, later] of scopes) {
      expect(
        findOverriddenRules([rule("rule-1", earlier), rule("rule-2", later)]),
      ).toEqual([]);
    }
  });

  it("does not mark later appends as overridden", () => {
    for (const earlierOperation of ["set", "append", "remove"] as const) {
      expect(
        findOverriddenRules([
          rule("rule-1", { type: "all" }, { operation: earlierOperation }),
          rule("rule-2", { type: "all" }, { operation: "append" }),
        ]),
      ).toEqual([]);
    }
  });

  it("does not let an earlier append override a later set or remove", () => {
    for (const laterOperation of ["set", "remove"] as const) {
      expect(
        findOverriddenRules([
          rule("rule-1", { type: "all" }, { operation: "append" }),
          rule("rule-2", { type: "all" }, { operation: laterOperation }),
        ]),
      ).toEqual([]);
    }
  });

  it("lets an earlier set or remove override a later set or remove", () => {
    for (const earlierOperation of ["set", "remove"] as const) {
      for (const laterOperation of ["set", "remove"] as const) {
        expect(
          findOverriddenRules([
            rule("rule-1", { type: "all" }, { operation: earlierOperation }),
            rule("rule-2", { type: "all" }, { operation: laterOperation }),
          ]),
        ).toEqual([{ ruleId: "rule-2", shadowedByRuleId: "rule-1" }]);
      }
    }
  });

  it("matches normalized header names while keeping directions separate", () => {
    expect(
      findOverriddenRules([
        rule("rule-1", { type: "all" }, { header: " X-Debug " }),
        rule("rule-2", { type: "all" }, { header: "x-DEBUG" }),
        rule("rule-3", { type: "all" }, { direction: "response" }),
      ]),
    ).toEqual([{ ruleId: "rule-2", shadowedByRuleId: "rule-1" }]);
  });

  it("ignores disabled rules in either position", () => {
    expect(
      findOverriddenRules([
        rule("rule-1", { type: "all" }, { enabled: false }),
        rule("rule-2", { type: "all" }),
        rule("rule-3", { type: "all" }, { enabled: false }),
      ]),
    ).toEqual([]);
  });

  it("reports the earliest qualifying rule above each overridden rule", () => {
    expect(
      findOverriddenRules([
        rule("rule-1", { type: "all" }),
        rule("rule-2", { type: "all" }),
        rule("rule-3", { type: "all" }, { operation: "remove" }),
      ]),
    ).toEqual([
      { ruleId: "rule-2", shadowedByRuleId: "rule-1" },
      { ruleId: "rule-3", shadowedByRuleId: "rule-1" },
    ]);
  });
});
