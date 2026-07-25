import { createProfile } from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import {
  expect,
  getBadgeColor,
  getBadgeText,
  seedState,
  test,
} from "../fixtures";

const GREY: [number, number, number, number] = [110, 123, 136, 255];
const INDIGO: [number, number, number, number] = [79, 91, 196, 255];
const BLUE: [number, number, number, number] = [26, 107, 199, 255];

test("paints the active profile's badge text and colour", async ({
  serviceWorker,
}) => {
  // The seed ships with the Default profile (badge "DE", indigo) active. The
  // badge carries it with no navigation and no traffic on any tab.
  await seedState(serviceWorker, createV1Seed());

  await expect.poll(() => getBadgeText(serviceWorker)).toBe("DE");
  expect(await getBadgeColor(serviceWorker)).toEqual(INDIGO);
});

test("repaints the badge when the active profile changes", async ({
  serviceWorker,
}) => {
  const seed = createV1Seed();
  const qa = createProfile({ name: "QA", badgeText: "QA", color: "blue" });
  await seedState(serviceWorker, {
    ...seed,
    profiles: [...seed.profiles, qa],
  });
  await expect.poll(() => getBadgeText(serviceWorker)).toBe("DE");

  await seedState(serviceWorker, {
    ...seed,
    profiles: [...seed.profiles, qa],
    activeProfileId: qa.id,
  });

  await expect.poll(() => getBadgeText(serviceWorker)).toBe("QA");
  expect(await getBadgeColor(serviceWorker)).toEqual(BLUE);
});

test("caps the badge field at two characters as the user types", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // The Default profile is active, so editing its badge repaints the toolbar.
  await seedState(serviceWorker, createV1Seed());

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#profiles`);
  await page.locator(".profile-open").first().click();

  const field = page.locator(".badge-text-input").first();
  await field.selectText();
  await field.pressSequentially("STG");

  // The browser refused the third keystroke, so the field shows exactly the two
  // characters the badge carries, and typing alone committed them.
  await expect(field).toHaveValue("ST");
  await expect.poll(() => getBadgeText(serviceWorker)).toBe("ST");
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
