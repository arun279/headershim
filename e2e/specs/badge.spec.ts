import { createV1Seed } from "../../src/core/schema";
import {
  activeTabId,
  expect,
  getBadgeColor,
  getBadgeText,
  seedState,
  stateWithRules,
  test,
} from "../fixtures";

// Chrome paints the count badge by substituting this sentinel for the live
// match count; its presence is the observable proof that the count is engaged
// (displayActionCountAsBadgeText === true). Chrome owns the painted number;
// HeaderShim's badge state transition is the behavior asserted here.
const COUNT_SENTINEL = "<<declarativeNetRequestActionCount>>";

const GREY: [number, number, number, number] = [110, 123, 136, 255];
const AMBER: [number, number, number, number] = [176, 123, 0, 255];
const INDIGO: [number, number, number, number] = [79, 91, 196, 255];

test("engages the Chrome-managed count badge", async ({
  context,
  echoServers,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${echoServers.h1Url}/count`);
  const tabId = await activeTabId(serviceWorker);

  // The seed ships with the Default profile active.
  await seedState(serviceWorker, createV1Seed());

  await expect
    .poll(() => getBadgeText(serviceWorker, tabId))
    .toBe(COUNT_SENTINEL);
  expect(await getBadgeColor(serviceWorker)).toEqual(INDIGO);
});

test("paints the paused Chrome badge grey", async ({ serviceWorker }) => {
  const doc = createV1Seed();
  await seedState(serviceWorker, {
    ...doc,
    settings: { ...doc.settings, paused: true },
  });

  await expect.poll(() => getBadgeColor(serviceWorker)).toEqual(GREY);
  expect(await getBadgeText(serviceWorker)).toBe("II");
});

test("paints the needs-access Chrome badge amber", async ({
  serviceWorker,
}) => {
  await seedState(
    serviceWorker,
    stateWithRules([
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
    ]),
  );

  await expect.poll(() => getBadgeColor(serviceWorker)).toEqual(AMBER);
  expect(await getBadgeText(serviceWorker)).toBe("!");
});
