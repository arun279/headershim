import { describe, expect, it } from "vitest";
import type { DnrRule } from "./compile";
import { normalize, planReconcile } from "./reconcile";
import { DNR_RESOURCE_TYPES, type DnrResourceType } from "./scope";

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

  it("treats a stable id change as drift", () => {
    const desired = [requestRule(21)];
    const actual = [{ ...requestRule(21), id: 22 }];

    expect(planReconcile(desired, actual)).toEqual({
      removeRuleIds: [22],
      addRules: desired,
    });
  });
});

describe("normalize", () => {
  it("sorts every object shape and fills omitted action arrays", () => {
    const normalized = normalize([requestRule(3)]);

    expect(Object.keys(normalized[0] ?? {})).toEqual([
      "action",
      "condition",
      "id",
      "priority",
    ]);
    expect(Object.keys(normalized[0]?.action ?? {})).toEqual([
      "requestHeaders",
      "responseHeaders",
      "type",
    ]);
    expect(Object.keys(normalized[0]?.condition ?? {})).toEqual([
      "requestDomains",
      "resourceTypes",
    ]);
    expect(normalized[0]?.action.responseHeaders).toEqual([]);
  });

  it("is idempotent across randomized rule arrays", () => {
    const random = mulberry32(0x5e_ed_20_26);

    for (let example = 0; example < 500; example += 1) {
      const input = Array.from({ length: integer(random, 0, 8) }, (_, index) =>
        arbitraryRule(random, example * 10 + index + 1),
      );
      const once = normalize(input);

      expect(normalize(once)).toEqual(once);
      expect(JSON.stringify(normalize(once))).toBe(JSON.stringify(once));
    }
  });
});

function arbitraryRule(random: () => number, id: number): DnrRule {
  const requestHeaders = arbitraryModifications(random);
  const responseHeaders = arbitraryModifications(random);
  const requestDomains = arbitraryStrings(random, "request");
  const initiatorDomains = arbitraryStrings(random, "initiator");
  const tabIds = Array.from({ length: integer(random, 0, 4) }, () =>
    integer(random, -1, 200),
  );
  const urlFilter = random() < 0.5 ? "" : `||host-${id}.example^`;
  const regexFilter = random() < 0.5 ? "" : `^https://host-${id}\\.example/`;
  const resourceTypes = Array.from({ length: integer(random, 0, 5) }, () =>
    choice(random, DNR_RESOURCE_TYPES),
  );

  if (random() < 0.5) {
    return {
      action: {
        ...(random() < 0.67 ? { responseHeaders } : {}),
        type: "modifyHeaders",
        ...(random() < 0.67 ? { requestHeaders } : {}),
      },
      condition: arbitraryCondition(
        random,
        resourceTypes,
        requestDomains,
        initiatorDomains,
        tabIds,
        urlFilter,
        regexFilter,
      ),
      id,
      priority: integer(random, 1, 10_000),
    };
  }

  return {
    priority: integer(random, 1, 10_000),
    id,
    condition: arbitraryCondition(
      random,
      resourceTypes,
      requestDomains,
      initiatorDomains,
      tabIds,
      urlFilter,
      regexFilter,
    ),
    action: {
      ...(random() < 0.67 ? { requestHeaders } : {}),
      ...(random() < 0.67 ? { responseHeaders } : {}),
      type: "modifyHeaders",
    },
  };
}

function arbitraryCondition(
  random: () => number,
  resourceTypes: DnrResourceType[],
  requestDomains: string[],
  initiatorDomains: string[],
  tabIds: number[],
  urlFilter: string,
  regexFilter: string,
): DnrRule["condition"] {
  if (random() < 0.5) {
    return {
      ...(random() < 0.5 ? { initiatorDomains } : {}),
      ...(random() < 0.5 ? { regexFilter } : {}),
      ...(random() < 0.5 ? { requestDomains } : {}),
      resourceTypes,
      ...(random() < 0.5 ? { tabIds } : {}),
      ...(random() < 0.5 ? { urlFilter } : {}),
    };
  }

  return {
    ...(random() < 0.5 ? { urlFilter } : {}),
    ...(random() < 0.5 ? { tabIds } : {}),
    resourceTypes,
    ...(random() < 0.5 ? { requestDomains } : {}),
    ...(random() < 0.5 ? { regexFilter } : {}),
    ...(random() < 0.5 ? { initiatorDomains } : {}),
  };
}

function arbitraryModifications(random: () => number) {
  return Array.from({ length: integer(random, 0, 4) }, (_, index) => ({
    header: `x-random-${index}`,
    operation: choice(random, ["set", "append", "remove"] as const),
    ...(random() < 0.5 ? {} : { value: random() < 0.5 ? "" : `${random()}` }),
  }));
}

function arbitraryStrings(random: () => number, prefix: string): string[] {
  return Array.from({ length: integer(random, 0, 4) }, (_, index) =>
    random() < 0.25 ? "" : `${prefix}-${index}.example`,
  );
}

function choice<T>(random: () => number, values: readonly T[]): T {
  const value = values[integer(random, 0, values.length - 1)];
  if (value === undefined) {
    throw new RangeError("Cannot choose from an empty array");
  }
  return value;
}

function integer(random: () => number, minimum: number, maximum: number) {
  return Math.floor(random() * (maximum - minimum + 1)) + minimum;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d_2b_79_f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
