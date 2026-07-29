import type { RuleDraft } from "../../src/core/model";
import {
  expect,
  fetchEcho,
  readEcho,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

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
