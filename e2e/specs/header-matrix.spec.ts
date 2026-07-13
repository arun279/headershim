import type { Page } from "@playwright/test";
import type { RuleDraft } from "../../src/core/model";
import type { EchoServers } from "../echo-servers";
import {
  expect,
  fetchEcho,
  grantAllSitesViaDetails,
  ON_WIRE_GRANT_UNAVAILABLE,
  readEcho,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

interface HeaderCase {
  readonly absent?: string;
  readonly draft: RuleDraft;
  readonly expected?: readonly [header: string, value: string];
  readonly name: string;
  readonly requestHeader?: readonly [header: string, value: string];
  readonly survives?: string;
  readonly transport: "cross-host" | "navigation";
}

const common = {
  direction: "request",
  scope: { type: "domains", domains: ["localhost"] },
  resourceTypes: "all",
  initiators: [],
  enabled: true,
} satisfies Omit<RuleDraft, "header" | "operation" | "value">;

const headerCases: readonly HeaderCase[] = [
  {
    name: "User-Agent set",
    draft: {
      ...common,
      operation: "set",
      header: "user-agent",
      value: "Headershim-UA-Verified",
    },
    expected: ["user-agent", "Headershim-UA-Verified"],
    transport: "navigation",
  },
  {
    name: "Origin set",
    draft: {
      ...common,
      operation: "set",
      header: "origin",
      value: "https://origin.headershim.test",
    },
    expected: ["origin", "https://origin.headershim.test"],
    transport: "navigation",
  },
  {
    name: "Origin remove",
    draft: {
      ...common,
      operation: "remove",
      header: "origin",
      scope: { type: "domains", domains: ["127.0.0.1"] },
    },
    absent: "origin",
    survives: "referer",
    transport: "cross-host",
  },
  {
    name: "Referer set",
    draft: {
      ...common,
      operation: "set",
      header: "referer",
      value: "https://referer.headershim.test/path",
    },
    expected: ["referer", "https://referer.headershim.test/path"],
    transport: "navigation",
  },
  {
    name: "Referer remove",
    draft: {
      ...common,
      operation: "remove",
      header: "referer",
      scope: { type: "domains", domains: ["127.0.0.1"] },
    },
    absent: "referer",
    survives: "origin",
    transport: "cross-host",
  },
  {
    name: "Accept-Language set",
    draft: {
      ...common,
      operation: "set",
      header: "accept-language",
      value: "zz-Headershim",
    },
    expected: ["accept-language", "zz-Headershim"],
    transport: "navigation",
  },
  {
    name: "custom header set",
    draft: {
      ...common,
      operation: "set",
      header: "x-headershim-matrix",
      value: "verified",
    },
    expected: ["x-headershim-matrix", "verified"],
    transport: "navigation",
  },
  {
    name: "custom header remove",
    draft: {
      ...common,
      operation: "remove",
      header: "x-before-remove",
      scope: { type: "domains", domains: ["127.0.0.1"] },
    },
    requestHeader: ["x-before-remove", "present-before-dnr"],
    absent: "x-before-remove",
    transport: "cross-host",
  },
  {
    name: "Cookie set",
    draft: {
      ...common,
      operation: "set",
      header: "cookie",
      value: "headershim_cookie=verified",
    },
    expected: ["cookie", "headershim_cookie=verified"],
    transport: "navigation",
  },
];

const h2Drafts: readonly RuleDraft[] = [
  {
    ...common,
    operation: "set",
    header: "host",
    value: "changed.invalid",
  },
  {
    ...common,
    operation: "set",
    header: "x-headershim-h2",
    value: "verified",
  },
];

test("header operations reconcile into accepted browser rules", async ({
  serviceWorker,
}) => {
  for (const row of headerCases) {
    const desired = await seedStateAndWait(
      serviceWorker,
      stateWithRules([row.draft]),
    );
    expect(desired).toHaveLength(1);
    expect(desired[0]?.action.requestHeaders?.[0]).toMatchObject({
      header: row.draft.header,
      operation: row.draft.operation,
    });
  }

  const h2Desired = await seedStateAndWait(
    serviceWorker,
    stateWithRules(h2Drafts),
  );
  expect(
    h2Desired.map((rule) => rule.action.requestHeaders?.[0]?.header),
  ).toEqual(["host", "x-headershim-h2"]);
});

test("HTTP/1.1 header operations are observable on the wire", async ({
  context,
  echoServers,
  extensionId,
  serviceWorker,
}) => {
  const firstCase = headerCases[0];
  if (firstCase === undefined) {
    throw new Error("header matrix is empty");
  }
  await seedStateAndWait(serviceWorker, stateWithRules([firstCase.draft]));
  const granted = await grantAllSitesViaDetails(
    context,
    extensionId,
    serviceWorker,
  );
  test.skip(!granted, ON_WIRE_GRANT_UNAVAILABLE);

  const page = await context.newPage();
  for (const [index, row] of headerCases.entries()) {
    if (index !== 0) {
      await seedStateAndWait(serviceWorker, stateWithRules([row.draft]));
    }
    const headers = await exerciseHeaderCase(page, echoServers, row, index);
    if (row.expected !== undefined) {
      expect(headers[row.expected[0]], row.name).toBe(row.expected[1]);
    }
    if (row.absent !== undefined) {
      expect(headers, row.name).not.toHaveProperty(row.absent);
    }
    if (row.survives !== undefined) {
      expect(headers[row.survives], row.name).toBeTruthy();
    }
  }
});

test("Host is a silent no-op over HTTP/2 while a custom header works", async ({
  context,
  echoServers,
  extensionId,
  serviceWorker,
}) => {
  await seedStateAndWait(serviceWorker, stateWithRules(h2Drafts));
  const granted = await grantAllSitesViaDetails(
    context,
    extensionId,
    serviceWorker,
  );
  test.skip(!granted, ON_WIRE_GRANT_UNAVAILABLE);

  const page = await context.newPage();
  await page.goto(`${echoServers.h2Url}/host-and-custom`);
  const headers = await readEcho(page);
  expect(headers[":authority"]).toBe(new URL(echoServers.h2Url).host);
  expect(headers[":authority"]).not.toBe("changed.invalid");
  expect(headers["x-headershim-h2"]).toBe("verified");
});

async function exerciseHeaderCase(
  page: Page,
  echoServers: EchoServers,
  row: HeaderCase,
  index: number,
): Promise<Record<string, string>> {
  if (row.transport === "navigation") {
    await page.goto(`${echoServers.h1Url}/matrix-${index}`);
    return readEcho(page);
  }

  await page.goto(`${echoServers.h1Url}/matrix-source-${index}`);
  const requestHeaders =
    row.requestHeader === undefined
      ? undefined
      : { [row.requestHeader[0]]: row.requestHeader[1] };
  const result = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/echo.json?case=${index}`,
    requestHeaders === undefined ? {} : { headers: requestHeaders },
  );
  expect(result.status).toBe(200);
  return result.requestHeaders;
}
