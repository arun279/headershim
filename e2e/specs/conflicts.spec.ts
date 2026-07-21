import { compileDynamic } from "../../src/core/compile";
import { findOverriddenRules } from "../../src/core/conflicts";
import type { RuleDraft, StateDoc } from "../../src/core/model";
import {
  expect,
  fetchEcho,
  readEcho,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

const sharedRule = {
  direction: "request",
  header: "x-headershim-order",
  scope: { type: "domains", domains: ["localhost"] },
  resourceTypes: "all",
  initiators: [],
  enabled: true,
} satisfies Omit<RuleDraft, "operation" | "value">;

test("overlapping header operations follow visible priority order", () => {
  const firstSet = draft("set", "first");
  const appended = draft("append", "stacked");
  const laterSet = draft("set", "ignored");
  const ordered = stateWithRules([firstSet, appended, laterSet]);
  const orderedRules = rulesOf(ordered);
  const orderedCompiled = compileDynamic(ordered);

  expect(orderedCompiled.map((rule) => rule.priority)).toEqual([
    5_000, 4_999, 4_998,
  ]);
  expect(
    orderedCompiled.map((rule) => rule.action.requestHeaders?.[0]?.operation),
  ).toEqual(["set", "append", "set"]);
  expect(
    orderedCompiled.map((rule) => rule.action.requestHeaders?.[0]?.value),
  ).toEqual(["first", "stacked", "ignored"]);
  expect(findOverriddenRules(orderedRules)).toEqual([
    {
      ruleId: orderedRules[2]?.id,
      shadowedByRuleId: orderedRules[0]?.id,
    },
  ]);

  const removeFirst = stateWithRules([
    draft("remove"),
    draft("append", "never-added"),
    draft("set", "never-set"),
  ]);
  const removeRules = rulesOf(removeFirst);
  expect(findOverriddenRules(removeRules)).toEqual([
    {
      ruleId: removeRules[1]?.id,
      shadowedByRuleId: removeRules[0]?.id,
    },
    {
      ruleId: removeRules[2]?.id,
      shadowedByRuleId: removeRules[0]?.id,
    },
  ]);
});

test("reordering changes the set operation that takes effect", () => {
  const first = stateWithRules([
    draft("set", "first"),
    draft("append", "stacked"),
    draft("set", "second"),
  ]);
  const firstRules = rulesOf(first);
  const [firstRule, appendRule, secondRule] = firstRules;
  if (
    firstRule === undefined ||
    appendRule === undefined ||
    secondRule === undefined
  ) {
    throw new Error("ordered conflict fixture is incomplete");
  }
  const reordered = {
    ...first,
    profiles: first.profiles.map((profile) => ({
      ...profile,
      rules: [secondRule, appendRule, firstRule],
    })),
  };
  const reorderedRules = rulesOf(reordered);

  expect(compileDynamic(first)[0]?.action.requestHeaders?.[0]?.value).toBe(
    "first",
  );
  expect(compileDynamic(reordered)[0]?.action.requestHeaders?.[0]?.value).toBe(
    "second",
  );
  expect(findOverriddenRules(reorderedRules)).toEqual([
    {
      ruleId: firstRule.id,
      shadowedByRuleId: secondRule.id,
    },
  ]);
});

test("Chrome applies set/append/remove conflicts in visible order", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const scenarios = [
    {
      drafts: [
        responseDraft("set", "first"),
        responseDraft("append", "stacked"),
        responseDraft("set", "ignored"),
      ],
      expected: "first, stacked",
      name: "set then append shadows a later set",
    },
    {
      drafts: [
        responseDraft("remove"),
        responseDraft("append", "never-added"),
        responseDraft("set", "never-set"),
      ],
      name: "remove stops every lower operation",
    },
    {
      drafts: [
        responseDraft("set", "second"),
        responseDraft("append", "stacked"),
        responseDraft("set", "first"),
      ],
      expected: "second, stacked",
      name: "reorder changes the winning set",
    },
  ] as const;

  await seedStateAndWait(serviceWorker, stateWithRules(scenarios[0].drafts));
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/conflict-source`);
  for (const [index, scenario] of scenarios.entries()) {
    if (index !== 0) {
      await seedStateAndWait(serviceWorker, stateWithRules(scenario.drafts));
    }
    const result = await fetchEcho(
      page,
      `${echoServers.h1CrossUrl}/echo.json?conflict=${index}`,
    );
    expect(result.status, scenario.name).toBe(200);
    if ("expected" in scenario) {
      expect(result.responseHeaders["x-headershim-order"], scenario.name).toBe(
        scenario.expected,
      );
    } else {
      expect(result.responseHeaders, scenario.name).not.toHaveProperty(
        "x-headershim-order",
      );
    }
  }
});

test("default resource types include top-level navigation", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const header = "x-headershim-main-frame";
  const value = "default-pages";
  const desired = await seedStateAndWait(
    serviceWorker,
    stateWithRules([
      {
        direction: "request",
        operation: "set",
        header,
        value,
        scope: { type: "domains", domains: ["localhost"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );
  expect(desired[0]?.condition.resourceTypes).toContain("main_frame");

  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/main-frame-default`);
  expect((await readEcho(page))[header]).toBe(value);
});

function draft(
  operation: "append" | "remove" | "set",
  value?: string,
): RuleDraft {
  return {
    ...sharedRule,
    operation,
    ...(value === undefined ? {} : { value }),
  };
}

function responseDraft(
  operation: "append" | "remove" | "set",
  value?: string,
): RuleDraft {
  return {
    direction: "response",
    operation,
    header: "x-headershim-order",
    ...(value === undefined ? {} : { value }),
    scope: { type: "domains", domains: ["127.0.0.1"] },
    resourceTypes: ["xhr"],
    initiators: [],
    enabled: true,
  };
}

function rulesOf(doc: StateDoc) {
  const rules = doc.profiles[0]?.rules;
  if (rules === undefined) {
    throw new Error("test state has no profile rules");
  }
  return rules;
}
