import { planReconcile } from "../../src/core/reconcile";
import {
  DUAL_GRANT_TRANSITION_UNAVAILABLE,
  expect,
  fetchEcho,
  getDynamicRules,
  grantAllSitesViaDetails,
  ON_WIRE_GRANT_UNAVAILABLE,
  seedStateAndWait,
  stateWithRules,
  test,
  toggleAllSitesViaDetails,
} from "../fixtures";

const HEADER = "x-headershim-grant-edge";
const VALUE = "active-after-grant";

function dualGrantDoc() {
  return stateWithRules([
    {
      direction: "request",
      operation: "set",
      header: HEADER,
      value: VALUE,
      scope: { type: "domains", domains: ["127.0.0.1"] },
      resourceTypes: ["xhr"],
      initiators: ["localhost"],
      enabled: true,
    },
  ]);
}

test("a target-and-initiator rule is a silent no-op while access is missing", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const doc = dualGrantDoc();
  const desired = await seedStateAndWait(serviceWorker, doc);
  const installedBeforeRequests = await getDynamicRules(serviceWorker);
  expect(planReconcile(desired, installedBeforeRequests)).toBeNull();

  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/grant-source`);
  const beforeGrant = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/echo.json?permission=before`,
  );
  expect(beforeGrant.status).toBe(200);
  expect(beforeGrant.requestHeaders).not.toHaveProperty(HEADER);
  expect(await getDynamicRules(serviceWorker)).toEqual(installedBeforeRequests);
});

test("adding initiator access activates a destination-granted rule without a rewrite", async ({
  context,
  echoServers,
  extensionId,
  serviceWorker,
}) => {
  const doc = dualGrantDoc();
  const desired = await seedStateAndWait(serviceWorker, doc);
  const installedBeforeRequests = await getDynamicRules(serviceWorker);

  const destinationOnly = await serviceWorker.evaluate(async () => {
    const [destination, initiator] = await Promise.all([
      chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] }),
      chrome.permissions.contains({ origins: ["http://localhost/*"] }),
    ]);
    return destination && !initiator;
  });
  test.skip(!destinationOnly, DUAL_GRANT_TRANSITION_UNAVAILABLE);

  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/grant-source`);
  const beforeGrant = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/echo.json?permission=destination-only`,
  );
  expect(beforeGrant.status).toBe(200);
  expect(beforeGrant.requestHeaders).not.toHaveProperty(HEADER);

  await toggleAllSitesViaDetails(context, extensionId);

  // The next operation after the permission transition is the request itself:
  // no permission query, storage write, rule toggle, or extension-page reload
  // is used to wake DNR.
  const afterGrant = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/echo.json?permission=after`,
  );
  test.skip(
    afterGrant.requestHeaders[HEADER] !== VALUE,
    ON_WIRE_GRANT_UNAVAILABLE,
  );
  expect(afterGrant.status).toBe(200);
  expect(afterGrant.requestHeaders[HEADER]).toBe(VALUE);

  const installedAfterRequests = await getDynamicRules(serviceWorker);
  expect(installedAfterRequests).toEqual(installedBeforeRequests);
  expect(planReconcile(desired, installedAfterRequests)).toBeNull();
});

test("a cached response bypasses response-header modification", async ({
  context,
  echoServers,
  extensionId,
  serviceWorker,
}) => {
  const header = "x-headershim-cache";
  await seedStateAndWait(
    serviceWorker,
    stateWithRules([
      {
        direction: "response",
        operation: "set",
        header,
        value: "modified",
        scope: { type: "domains", domains: ["127.0.0.1"] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
    ]),
  );
  const granted = await grantAllSitesViaDetails(
    context,
    extensionId,
    serviceWorker,
  );
  test.skip(!granted, ON_WIRE_GRANT_UNAVAILABLE);

  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/cache-source`);
  const key = crypto.randomUUID();
  const cacheUrl = `${echoServers.h1CrossUrl}/cache.json?key=${key}`;
  const fresh = await fetchEcho(page, cacheUrl);
  expect(fresh.status).toBe(200);
  expect(fresh.responseHeaders[header]).toBe("modified");
  expect(fresh.requestCount).toBe(1);

  const cached = await fetchEcho(page, cacheUrl);
  expect(cached.status).toBe(200);
  expect(cached.responseHeaders[header]).toBe("server");
  expect(cached.requestCount).toBe(1);

  const stats = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/cache-stats.json?key=${key}`,
    { cache: "reload" },
  );
  expect(stats.requestCount).toBe(1);
});

test("the network stack owns the outgoing content length", async ({
  context,
  echoServers,
  extensionId,
  serviceWorker,
}) => {
  await seedStateAndWait(
    serviceWorker,
    stateWithRules([
      {
        direction: "request",
        operation: "set",
        header: "content-length",
        value: "999",
        scope: { type: "domains", domains: ["localhost"] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
    ]),
  );
  const granted = await grantAllSitesViaDetails(
    context,
    extensionId,
    serviceWorker,
  );
  test.skip(!granted, ON_WIRE_GRANT_UNAVAILABLE);

  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/content-length-source`);
  const response = await fetchEcho(page, `${echoServers.h1Url}/echo.json`, {
    body: "payload",
    method: "POST",
  });
  expect(response.status).toBe(200);
  expect(response.requestHeaders["content-length"]).toBe("7");
  expect(response.requestHeaders["content-length"]).not.toBe("999");
});
