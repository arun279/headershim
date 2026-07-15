import { planReconcile } from "../../src/core/reconcile";
import { copy } from "../../src/ui/copy";
import {
  BROAD_GRANT_REVOCATION_UNAVAILABLE,
  DUAL_GRANT_TRANSITION_UNAVAILABLE,
  expect,
  fetchEcho,
  getDynamicRules,
  grantAllSitesViaDetails,
  ON_WIRE_GRANT_UNAVAILABLE,
  seedState,
  seedStateAndWait,
  stateWithRules,
  test,
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

  const granted = await grantAllSitesViaDetails(
    context,
    extensionId,
    serviceWorker,
  );
  // Gate on the grant landing (an independent permissions signal), not on the
  // header itself — folding the on-wire check into the skip would let a
  // grant-lands-but-DNR-stops-applying regression report as an env-skip.
  test.skip(!granted, ON_WIRE_GRANT_UNAVAILABLE);

  // The next operation after the permission transition is the request itself:
  // no permission query, storage write, rule toggle, or extension-page reload
  // is used to wake DNR.
  const afterGrant = await fetchEcho(
    page,
    `${echoServers.h1CrossUrl}/echo.json?permission=after`,
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

// UI half: an ungranted rule must light the loud needs-access state in
// the popup, not fail silently. The network half (destination-only → initiator)
// lives above; this asserts the surface that tells the user access is missing.
test("an ungranted rule lights the loud needs-access state in the popup", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(
    serviceWorker,
    stateWithRules([
      {
        direction: "request",
        operation: "set",
        header: "x-headershim-loud",
        value: "1",
        scope: { type: "domains", domains: ["needs.example.test"] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const annunciator = popup.locator(".annunciator");
  await expect(annunciator).toHaveAttribute("data-state", "needs-access");
  // The loud state carries its one-click recovery, not just a color change.
  await expect(annunciator.getByRole("button")).toBeVisible();

  // The row tells the same truth. The switch preserves the user's requested
  // on-state, while the held styling, status words, and recovery action make
  // clear that the rule cannot run yet.
  const row = popup.locator(".rule-row").first();
  await expect(row).toHaveClass(/\bblocked\b/);
  await expect(row).not.toHaveClass(/\brunning\b/);
  await expect(row.locator(".rule-status")).toContainText("Needs access");
  await expect(row.locator(".rule-status")).toContainText("needs.example.test");
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(
    row.getByRole("button", { name: copy.actions.grant, exact: true }),
  ).toBeVisible();
});

// Site-access UI half: the Site access page is a projection of the
// browser's live permissions plus the rules' required origins. In the unpacked
// headless posture no host grant is obtainable (grants.spec's revocation-
// survival half is deferred for the same reason), so the browser's reality is
// "nothing granted": every enabled rule's origin sits under needed-but-not-
// granted, the granted group is empty, and the broad-grant offer stands. The
// page must match that reality exactly.
test("the site-access page mirrors the browser's granted and needed origins", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(
    serviceWorker,
    stateWithRules([
      {
        direction: "request",
        operation: "set",
        header: "x-a",
        value: "1",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
      {
        direction: "request",
        operation: "set",
        header: "x-b",
        value: "1",
        scope: { type: "domains", domains: ["api.example.com"] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#site-access`);
  await expect(page.locator(".page-title")).toBeVisible();

  const text = copy.options.siteAccess;
  const needed = page.getByRole("list", { name: text.neededHeading });
  await expect(needed.locator(".sa-domain")).toHaveText([
    "api.example.com",
    "example.com",
  ]);

  // No grant is obtainable here, so the granted group is absent and the broad
  // grant is offered (not the revoke-all card) — the post-revoke reality.
  await expect(
    page.getByRole("heading", { name: text.grantedHeading, exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".sa-all-sites")).toBeVisible();
  await expect(page.locator(".sa-all-on")).toHaveCount(0);

  // The broad grant is gated by its disclosure. While collapsed, only the
  // consequence and review trigger exist; the permission action is absent
  // from both the DOM and keyboard order.
  const allSites = text.allSites;
  const disclosure = page.getByRole("button", {
    name: allSites.disclosure,
  });
  const allowAll = page.getByRole("button", {
    name: allSites.button,
    exact: true,
  });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(allowAll).toHaveCount(0);

  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".sa-all-warning")).toHaveText(allSites.warning);
  await expect(allowAll).toBeVisible();
  expect(
    await page.locator(".sa-all-details").evaluate((details) => {
      const warning = details.querySelector(".sa-all-warning");
      const button = details.querySelector("button");
      return (
        warning !== null &&
        button !== null &&
        Boolean(
          warning.compareDocumentPosition(button) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
      );
    }),
  ).toBe(true);

  // The page is a faithful mirror: its granted rows equal the browser's live
  // origins (both empty), so nothing is claimed that permissions.getAll denies.
  const live = await serviceWorker.evaluate(async () => {
    const all = await chrome.permissions.getAll();
    return (all.origins ?? []).filter((origin) => origin !== "*://*/*");
  });
  expect(live).toEqual([]);
});

// Whether individually granted sites survive revoking a broad all-sites
// grant. Staging it needs a real all-sites grant to then revoke, which the
// unpacked headless posture cannot obtain; verified manually against real
// Chrome before release.
test("individual grants survive broad-grant revocation", async () => {
  test.skip(true, BROAD_GRANT_REVOCATION_UNAVAILABLE);
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
