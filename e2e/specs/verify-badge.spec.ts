import type { StateDoc, TabOverride } from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import {
  activeTabId,
  expect,
  getBadgeColor,
  getBadgeText,
  seedSessionAndWait,
  seedState,
  stateWithRules,
  test,
} from "../fixtures";

// Chrome paints the count badge by substituting this sentinel for the live
// match count; its presence is the observable proof that count mode is engaged
// (displayActionCountAsBadgeText === true). Chrome owns the painted number;
// HeaderShim's badge state transition is the behavior asserted here.
const COUNT_SENTINEL = "<<declarativeNetRequestActionCount>>";

const GREY: [number, number, number, number] = [110, 123, 136, 255];
const AMBER: [number, number, number, number] = [176, 123, 0, 255];
const INDIGO: [number, number, number, number] = [79, 91, 196, 255];

function withSettings(doc: StateDoc, settings: Partial<StateDoc["settings"]>) {
  return { ...doc, settings: { ...doc.settings, ...settings } };
}

function allProfilesOff(doc: StateDoc): StateDoc {
  return { ...doc, activeProfileId: undefined };
}

function tabOverride(tabId: number, originHost: string): TabOverride {
  return {
    num: 1,
    tabId,
    originHost,
    direction: "request",
    operation: "set",
    header: "x-headershim-this-tab",
    value: "session",
    enabled: true,
  };
}

function needsAccessDoc(): StateDoc {
  return stateWithRules([
    {
      direction: "request",
      operation: "set",
      header: "x-headershim-needs-access",
      value: "1",
      scope: { type: "domains", domains: ["needs.example.test"] },
      resourceTypes: ["xhr"],
      initiators: [],
      enabled: true,
    },
  ]);
}

// ── Badge state machine end-to-end ──────────────────────────────────────────

test("count mode engages the Chrome-managed count badge", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/count`);
  const tabId = await activeTabId(serviceWorker);

  // The seed ships count mode with the Default profile active.
  await seedState(serviceWorker, createV1Seed());

  await expect
    .poll(() => getBadgeText(serviceWorker, tabId))
    .toBe(COUNT_SENTINEL);
  expect(await getBadgeColor(serviceWorker)).toEqual(INDIGO);
});

test("initials mode paints the focused profile's badge text", async ({
  serviceWorker,
}) => {
  await seedState(
    serviceWorker,
    withSettings(createV1Seed(), { badgeMode: "initials" }),
  );

  await expect.poll(() => getBadgeText(serviceWorker)).toBe("DE");
  expect(await getBadgeColor(serviceWorker)).toEqual(INDIGO);
});

test("a This-tab override marks its tab with T when no profile is active", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/marker`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedState(
    serviceWorker,
    withSettings(allProfilesOff(createV1Seed()), { badgeMode: "initials" }),
  );
  await seedSessionAndWait(serviceWorker, [tabOverride(tabId, originHost)]);

  // Modified traffic is never invisible: the override tab carries a "T" while
  // the global badge and every other tab stay empty.
  await expect.poll(() => getBadgeText(serviceWorker, tabId)).toBe("T");
  expect(await getBadgeText(serviceWorker)).toBe("");
});

test("paused outranks content mode and sweeps per-tab text with no stale bleed-through", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/paused`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  const base = withSettings(allProfilesOff(createV1Seed()), {
    badgeMode: "initials",
  });
  await seedState(serviceWorker, base);
  await seedSessionAndWait(serviceWorker, [tabOverride(tabId, originHost)]);
  await expect.poll(() => getBadgeText(serviceWorker, tabId)).toBe("T");

  // Entering the global paused tier must clear the tab's "T"; a switch to that
  // tab under a global state shows no stale per-tab bleed-through.
  await seedState(serviceWorker, withSettings(base, { paused: true }));
  await expect.poll(() => getBadgeText(serviceWorker, tabId)).toBe("");
  expect(await getBadgeText(serviceWorker)).toBe("");
  expect(await getBadgeColor(serviceWorker)).toEqual(GREY);
});

test("needs-access outranks content mode with the amber can't-run badge and no stale bleed-through", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/needs-access`);
  const tabId = await activeTabId(serviceWorker);
  const originHost = new URL(echoServers.h1Url).hostname;

  await seedState(
    serviceWorker,
    withSettings(allProfilesOff(createV1Seed()), { badgeMode: "initials" }),
  );
  await seedSessionAndWait(serviceWorker, [tabOverride(tabId, originHost)]);
  await expect.poll(() => getBadgeText(serviceWorker, tabId)).toBe("T");

  // A rule that needs a grant lights the amber global tier and sweeps the "T".
  await seedState(serviceWorker, needsAccessDoc());
  await expect.poll(() => getBadgeColor(serviceWorker)).toEqual(AMBER);
  expect(await getBadgeText(serviceWorker, tabId)).toBe("");
  expect(await getBadgeText(serviceWorker)).toBe("");
});

// ── Verify service (cases 11, 12) ───────────────────────────────────────────

// The gate premise, confirmed on the wire: without a gesture-granted activeTab
// (and with the declarativeNetRequestFeedback permission barred by policy),
// getMatchedRules rejects. This is why Verify is a per-tab, on-demand,
// gesture-driven feature rather than a live console — and why the tally, quota,
// and popup-gesture halves below can only run behind a real gesture.
test("getMatchedRules rejects without a gesture-granted activeTab", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/verify`);
  const tabId = await activeTabId(serviceWorker);

  const rejected = await serviceWorker.evaluate(async (id: number) => {
    try {
      await chrome.declarativeNetRequest.getMatchedRules({ tabId: id });
      return false;
    } catch {
      return true;
    }
  }, tabId);
  expect(rejected).toBe(true);
});
