import type { TabOverride } from "../../src/core/model";
import {
  activeTabId,
  expect,
  fetchEcho,
  getSessionRules,
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
  };
}

// A This-tab session override's confinement is a property of the compiled
// rule's own condition. The structural cases assert that condition against the
// shipped build; tagged traffic and lifetime cases use the static-host-access
// e2e artifact so Chromium exposes the tab URL and applies the session rule.

test("a This-tab override compiles to a session rule confined to its tab and origin", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
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
  // excluded — the confinement promise, before any grant enters the picture.
  expect(rule?.condition.tabIds).toEqual([tabId]);
  expect(rule?.condition.requestDomains).toEqual([originHost]);
  expect(rule?.condition.resourceTypes).toContain("main_frame");
  expect(rule?.action.requestHeaders?.[0]).toMatchObject({
    header: "x-headershim-this-tab",
    operation: "set",
    value: "session",
  });
});

test("cross-tab confinement holds regardless of open same-origin and cross-origin tabs", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
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

  // The session band still names only the tab the override was added to. The
  // confinement is the rule's condition, not an artifact of missing grants, so
  // it would hold identically with all-sites granted.
  const rules = await getSessionRules(serviceWorker);
  expect(rules).toHaveLength(1);
  expect(rules[0]?.condition.tabIds).toEqual([firstTabId]);
});

test("a navigation with no visible url drains the override and it stays ended across a round trip", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  // Headless without an activeTab grant, tab.url is undefined on every
  // onUpdated, so enforceOverrideLifetime prunes on every navigation. This spec
  // therefore proves the drain-and-stay-drained lifecycle, not the
  // same-site-keeps vs cross-site-drops distinction — that distinction is owned
  // by the unit test in src/test/background.test.ts, which can feed a visible
  // same-origin url and assert the row survives.
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/a`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedSessionAndWait(serviceWorker, [override(tabId, originHost)]);

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

test("closing a tab ends its overrides", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/closing`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedSessionAndWait(serviceWorker, [override(tabId, originHost)]);

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
