import type { TabOverride } from "../../src/core/model";
import {
  activeTabId,
  expect,
  fetchEcho,
  getSessionRules,
  seedSession,
  seedSessionAndWait,
  test,
} from "../fixtures";

function override(tabId: number, originHost: string, num = 1): TabOverride {
  return {
    num,
    tabId,
    originHost,
    direction: "request",
    operation: "set",
    header: "x-headershim-this-tab",
    value: "session",
    enabled: true,
  };
}

// A This-tab session override's confinement is a property of the compiled
// rule's own condition. Those structural and traffic specs use the static-host-
// access artifact so Chromium exposes the tab URL and installs the rule. The
// first spec owns the complementary shipped-build guarantee: without a grant,
// the persisted row never enters the session band.

test("the shipped build keeps an ungranted This-tab row out of the session band", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/ungranted`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;
  const row = override(tabId, originHost);

  // Begin with a stale rule so zero can only be observed after reconcile has
  // run. The sentinel deliberately omits optional resourceTypes, matching a
  // legal browser-returned rule shape that normalization must tolerate. With
  // the grant filter broken, reconcile replaces it with the ungranted override
  // and the poll never reaches zero.
  await serviceWorker.evaluate(() =>
    chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: 999_999,
          priority: 1,
          action: { type: "block" },
          condition: { urlFilter: "||headershim-settling.invalid/" },
        },
      ],
      removeRuleIds: [],
    }),
  );
  expect(await getSessionRules(serviceWorker)).toHaveLength(1);

  await seedSession(serviceWorker, {
    nextNum: 2,
    tabs: { [tabId]: [row] },
  });

  await expect
    .poll(async () => (await getSessionRules(serviceWorker)).length)
    .toBe(0);
});

test("a This-tab override compiles to a session rule confined to its tab and origin", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/this-tab`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedSessionAndWait(serviceWorker, [override(tabId, originHost)]);

  const rules = await getSessionRules(serviceWorker);
  expect(rules).toHaveLength(1);
  const [rule] = rules;
  // Tab confinement and origin scoping are the rule's own condition: only this
  // tab's requests to its own origin match, so the main frame and same-origin
  // subresources are in scope while cross-origin subresources (a different
  // requestDomain) and every other tab (a different tabId) are structurally
  // excluded. Broad access is granted here, so the confinement on show is the
  // condition's own and not an artifact of a narrow grant.
  expect(rule?.condition.tabIds).toEqual([tabId]);
  expect(rule?.condition.requestDomains).toEqual([originHost]);
  expect(rule?.condition.resourceTypes).toContain("main_frame");
  expect(rule?.action.requestHeaders?.[0]).toMatchObject({
    header: "x-headershim-this-tab",
    operation: "set",
    value: "session",
  });
});

test("cross-tab confinement holds regardless of open same-origin and cross-origin tabs", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const first = await context.newPage();
  await first.goto(`${echoServers.h1Url}/tab-a`);
  const firstTabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedSessionAndWait(serviceWorker, [override(firstTabId, originHost)]);

  // A second same-origin tab and a cross-origin tab exist alongside it.
  const sameOrigin = await context.newPage();
  await sameOrigin.goto(`${echoServers.h1Url}/tab-b`);
  const sameOriginTabId = await activeTabId(serviceWorker);
  const crossOrigin = await context.newPage();
  await crossOrigin.goto(`${echoServers.h1CrossUrl}/tab-c`);
  const crossOriginTabId = await activeTabId(serviceWorker);

  expect(sameOriginTabId).not.toBe(firstTabId);
  expect(crossOriginTabId).not.toBe(firstTabId);

  // The session band still names only the tab the override was added to, with
  // all sites granted: the confinement is the rule's condition, not an artifact
  // of a grant that stops short of the other tabs.
  const rules = await getSessionRules(serviceWorker);
  expect(rules).toHaveLength(1);
  expect(rules[0]?.condition.tabIds).toEqual([firstTabId]);
});

test("a cross-origin navigation drains the override and it stays ended across a round trip", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/a`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedSessionAndWait(serviceWorker, [override(tabId, originHost)]);
  expect(await getSessionRules(serviceWorker)).toHaveLength(1);

  // A → B: the row is pruned on the hop, draining the session band.
  await page.goto(`${echoServers.h1CrossUrl}/b`);
  await expect
    .poll(async () => (await getSessionRules(serviceWorker)).length)
    .toBe(0);

  // B → A (back): re-clicking would re-grant activeTab, but the override rows
  // are gone, so the tab stays stopped. Nothing resurrects them.
  await page.goto(`${echoServers.h1Url}/a-again`);
  await expect
    .poll(async () => (await getSessionRules(serviceWorker)).length)
    .toBe(0);
});

test("closing a tab ends its overrides", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/closing`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedSessionAndWait(serviceWorker, [override(tabId, originHost)]);
  expect(await getSessionRules(serviceWorker)).toHaveLength(1);

  await page.close();
  await expect
    .poll(async () => (await getSessionRules(serviceWorker)).length)
    .toBe(0);
});

test("a same-site navigation and an SPA route change keep the override", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/same-site-start`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedSessionAndWait(serviceWorker, [override(tabId, originHost)]);

  const navigatedUrl = `${echoServers.h1Url}/same-site-navigation`;
  await page.goto(navigatedUrl);
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        (id) =>
          chrome.tabs
            .query({ active: true, lastFocusedWindow: true })
            .then(([tab]) => (tab?.id === id ? tab.url : undefined)),
        tabId,
      ),
    )
    .toBe(navigatedUrl);
  await expect
    .poll(async () => (await getSessionRules(serviceWorker)).length)
    .toBe(1);

  const spaUrl = `${echoServers.h1Url}/same-site-spa`;
  await page.evaluate((url) => history.pushState({}, "", url), spaUrl);
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        (id) =>
          chrome.tabs
            .query({ active: true, lastFocusedWindow: true })
            .then(([tab]) => (tab?.id === id ? tab.url : undefined)),
        tabId,
      ),
    )
    .toBe(spaUrl);
  await expect
    .poll(async () => (await getSessionRules(serviceWorker)).length)
    .toBe(1);
});

// The on-wire half: a This-tab override actually modifying a same-origin request
// uses the static host grant from the e2e artifact. Seeding happens after the
// navigation so no hop can prune the row before the request is made.
test("a granted This-tab override modifies a same-origin request", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/on-wire`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedSessionAndWait(serviceWorker, [override(tabId, originHost)]);

  const result = await fetchEcho(page, `${echoServers.h1Url}/echo.json`);
  expect(result.status).toBe(200);
  expect(result.requestHeaders["x-headershim-this-tab"]).toBe("session");
});
