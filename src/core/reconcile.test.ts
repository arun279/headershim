import { describe, expect, it } from "vitest";
import type { DnrRule } from "./compile";
import { planReconcile } from "./reconcile";

function requestRule(id: number): DnrRule {
  return {
    id,
    priority: 5_000 - id,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "x-debug", operation: "set", value: `${id}` }],
    },
    condition: {
      requestDomains: [`host-${id}.example`],
      resourceTypes: ["xmlhttprequest"],
    },
  };
}

describe("planReconcile", () => {
  it("returns null for converged sets regardless of rule order", () => {
    const desired = [requestRule(1), requestRule(2)];

    expect(planReconcile(desired, [...desired].reverse())).toBeNull();
  });

  it("returns null for a default-filled echo with different object key order", () => {
    const desired = [requestRule(7)];
    const actual: DnrRule[] = [
      {
        condition: {
          resourceTypes: ["xmlhttprequest"],
          requestDomains: ["host-7.example"],
        },
        action: {
          responseHeaders: [],
          requestHeaders: [{ value: "7", operation: "set", header: "x-debug" }],
          type: "modifyHeaders",
        },
        priority: 4_993,
        id: 7,
      },
    ];

    expect(planReconcile(desired, actual)).toBeNull();
  });

  it("converges when the echo reorders resourceTypes and requestDomains", () => {
    const desired: DnrRule[] = [
      {
        id: 3,
        priority: 4_997,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "x-debug", operation: "set", value: "3" }],
        },
        condition: {
          requestDomains: ["a.example", "b.example"],
          resourceTypes: ["script", "xmlhttprequest"],
        },
      },
    ];
    // Chrome canonicalizes both arrays to some order of its own; a per-rule
    // stringify compare must still converge or the whole ruleset churns forever.
    const echoed: DnrRule[] = [
      {
        ...(desired[0] as DnrRule),
        condition: {
          requestDomains: ["b.example", "a.example"],
          resourceTypes: ["xmlhttprequest", "script"],
        },
      },
    ];

    expect(planReconcile(desired, echoed)).toBeNull();
  });

  it("converges when readback adds default condition fields", () => {
    const desired = [requestRule(8)];
    const actual = [
      {
        ...requestRule(8),
        condition: {
          ...requestRule(8).condition,
          isUrlFilterCaseSensitive: false,
        },
      },
    ];

    expect(planReconcile(desired, actual)).toBeNull();
  });

  it("replaces a case-sensitive echo of a case-insensitive filter", () => {
    const desiredRule: DnrRule = {
      ...requestRule(8),
      condition: {
        ...requestRule(8).condition,
        urlFilter: "|https://example.com/API",
      },
    };
    const desired = [desiredRule];
    const actual = [
      {
        ...desiredRule,
        condition: {
          ...desiredRule.condition,
          isUrlFilterCaseSensitive: true,
        },
      },
    ];

    expect(planReconcile(desired, actual)).toEqual({
      removeRuleIds: [8],
      addRules: desired,
    });
  });

  it("replaces an echo that reorders header modifications", () => {
    const modifications: DnrRule["action"]["requestHeaders"] = [
      { header: "x-trace", operation: "append", value: "a" },
      { header: "x-trace", operation: "append", value: "b" },
    ];
    const desired: DnrRule[] = [
      {
        ...requestRule(9),
        action: { type: "modifyHeaders", requestHeaders: modifications },
      },
    ];
    const echoed: DnrRule[] = [
      {
        ...requestRule(9),
        action: {
          type: "modifyHeaders",
          requestHeaders: [...modifications].reverse(),
        },
      },
    ];

    expect(planReconcile(desired, echoed)).not.toBeNull();
  });

  it("returns a whole-set replacement for any drift", () => {
    const desired = [requestRule(11), requestRule(12)];
    const actual: DnrRule[] = [
      requestRule(91),
      {
        ...requestRule(92),
        condition: {
          requestDomains: ["drift.example"],
          resourceTypes: ["xmlhttprequest"],
        },
      },
      requestRule(93),
    ];

    const plan = planReconcile(desired, actual);

    expect(plan).toEqual({
      removeRuleIds: [91, 92, 93],
      addRules: desired,
    });
    expect(plan?.addRules).toBe(desired);
  });

  it("removes an installed rule that omits resourceTypes", () => {
    const installed: DnrRule = {
      id: 999_999,
      priority: 1,
      action: { type: "modifyHeaders" },
      condition: { urlFilter: "||stale.example/" },
    };

    expect(planReconcile([], [installed])).toEqual({
      removeRuleIds: [999_999],
      addRules: [],
    });
  });

  it("treats a stable id change as drift", () => {
    const desired = [requestRule(21)];
    const actual = [{ ...requestRule(21), id: 22 }];

    expect(planReconcile(desired, actual)).toEqual({
      removeRuleIds: [22],
      addRules: desired,
    });
  });
});
