import type { Worker } from "@playwright/test";
import type { StateDoc, TabOverride } from "../../src/core/model";
import {
  activeTabId,
  expect,
  fetchEcho,
  getSessionRules,
  type SessionSeed,
  seedSession,
  seedSessionAndWait,
  test,
} from "../fixtures";

function override(tabId: number, origin: string, num = 1): TabOverride {
  return {
    num,
    tabId,
    origin,
    direction: "request",
    operation: "set",
    header: "x-headershim-this-tab",
    value: "session",
    enabled: true,
  };
}

// Reconcile owns the whole session band: it removes every installed rule it did
// not compile, and a single pass applies its removals and additions in one
// updateSessionRules call. That makes a rule the product never compiles a
// settling probe, and it makes an empty band a positive observation rather than
// an absence: a pass that had compiled an override would swap the probe for it
// atomically, so the band would go from the probe straight to the override and
// never be seen empty. The probe omits the optional resourceTypes, matching a
// legal browser-returned rule shape that normalization has to tolerate, and it
// carries the compiled action shape so getSessionRules keeps returning what it
// says it returns while the probe is installed.
//
// The seed is what wakes reconcile, and storage drops a write that changes
// nothing, so each drain has to advance the allocator to stay a trigger.
async function drainThroughReconcile(
  worker: Worker,
  seed: SessionSeed,
): Promise<void> {
  await worker.evaluate(() =>
    chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: 999_999,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "x-headershim-settling", operation: "set", value: "1" },
            ],
          },
          condition: { urlFilter: "||headershim-settling.invalid/" },
        },
      ],
      removeRuleIds: [],
    }),
  );
  await seedSession(worker, seed);
  await expect.poll(async () => (await getSessionRules(worker)).length).toBe(0);
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
  const origin = new URL(echoServers.h1Url).origin;
  const row = override(tabId, origin);

  // The row is stored before either probe, so it is there to be compiled by
  // every pass the probes wait on.
  await seedSession(serviceWorker, { nextNum: 2, tabs: { [tabId]: [row] } });

  // The first drain is a barrier, not the proof: the pass that answers it may
  // have read the session before the row landed and dropped the probe knowing
  // nothing about it. Reconcile is single-flight, so every pass that begins
  // after that one read the stored row, and only such a pass can answer the
  // second drain. Its empty band is the guarantee: without the grant filter,
  // that same pass would have installed the ungranted override instead.
  await drainThroughReconcile(serviceWorker, {
    nextNum: 3,
    tabs: { [tabId]: [row] },
  });
  await drainThroughReconcile(serviceWorker, {
    nextNum: 4,
    tabs: { [tabId]: [row] },
  });

  // The band is empty because the grant filter dropped the row, and not because
  // there was nothing to compile: compileSession returns an empty band outright
  // while the profile is paused, and the background prunes a tab's rows on a
  // navigation or a close. Both leave a trace, and neither is what happened.
  const stored = await serviceWorker.evaluate(async (id) => {
    const { state } = await chrome.storage.local.get("state");
    const { sessionState } = await chrome.storage.session.get("sessionState");
    return {
      paused: (state as StateDoc | undefined)?.settings.paused,
      rows: (sessionState as SessionSeed | undefined)?.tabs[id],
    };
  }, tabId);
  expect(stored.paused).toBe(false);
  expect(stored.rows).toEqual([row]);
});

test("a This-tab override compiles to a session rule confined to its tab and origin", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/this-tab`);
  const tabId = await activeTabId(serviceWorker);
  const origin = new URL(echoServers.h1Url).origin;

  await seedSessionAndWait(serviceWorker, [override(tabId, origin)]);

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
  expect(rule?.condition.requestDomains).toEqual([new URL(origin).hostname]);
  expect(rule?.condition.urlFilter).toBe(`|${origin}/`);
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
  const origin = new URL(echoServers.h1Url).origin;

  await seedSessionAndWait(serviceWorker, [override(firstTabId, origin)]);

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
  const origin = new URL(echoServers.h1Url).origin;

  await seedSessionAndWait(serviceWorker, [override(tabId, origin)]);
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
  const origin = new URL(echoServers.h1Url).origin;

  await seedSessionAndWait(serviceWorker, [override(tabId, origin)]);
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
  const origin = new URL(echoServers.h1Url).origin;

  await seedSessionAndWait(serviceWorker, [override(tabId, origin)]);

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
  const origin = new URL(echoServers.h1Url).origin;

  await seedSessionAndWait(serviceWorker, [override(tabId, origin)]);

  const result = await fetchEcho(page, `${echoServers.h1Url}/echo.json`);
  expect(result.status).toBe(200);
  expect(result.requestHeaders["x-headershim-this-tab"]).toBe("session");
});

test("a This-tab override does not modify a request to another origin", {
  tag: "@host-access",
}, async ({ context, echoServers, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/origin-negative`);
  const tabId = await activeTabId(serviceWorker);
  const origin = new URL(echoServers.h1Url).origin;

  await seedSessionAndWait(serviceWorker, [override(tabId, origin)]);

  // Both echo fixtures use localhost, so this isolates the scheme-and-port
  // boundary rather than merely proving request-domain confinement.
  const result = await fetchEcho(page, `${echoServers.h2Url}/echo.json`);
  expect(result.status).toBe(200);
  expect(result.requestHeaders["x-headershim-this-tab"]).toBeUndefined();
});
