import type { Worker } from "@playwright/test";
import { createRule, type StateDoc } from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import { copy } from "../../src/ui/copy";
import { expect, seedState, test } from "../fixtures";

async function readState(worker: Worker): Promise<StateDoc> {
  return worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    return state as StateDoc;
  });
}

test("a popup-created profile becomes active without reloading", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const seed = createV1Seed();
  const [firstRule, next] = createRule(seed, {
    direction: "request",
    operation: "set",
    header: "x-environment",
    value: "staging",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
  });
  const firstProfile = next.profiles[0];
  if (firstProfile === undefined) {
    throw new Error("seed has no profile");
  }
  await seedState(serviceWorker, {
    ...next,
    profiles: [{ ...firstProfile, rules: [firstRule] }],
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const marker = await page.evaluate(() => {
    const value = crypto.randomUUID();
    (
      window as Window & { __headershimE2eMarker?: string }
    ).__headershimE2eMarker = value;
    return value;
  });
  const url = page.url();

  // The popup's profiles live behind the picker, so the New profile action is
  // reachable only once it is open.
  await page
    .getByRole("button", { name: copy.readout.switcher.chipLabel, exact: true })
    .click();
  await page
    .getByRole("button", {
      name: copy.readout.switcher.newProfile,
      exact: true,
    })
    .click();
  // The popup names the profile itself, so the picker reads back the new one as
  // active with no naming step in between.
  const created = copy.options.profiles.newName;
  await expect(page.locator(".prof .lbl")).toHaveText(created);
  expect(page.url()).toBe(url);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __headershimE2eMarker?: string })
          .__headershimE2eMarker,
    ),
  ).toBe(marker);

  await expect
    .poll(async () => {
      const doc = await readState(serviceWorker);
      return doc.profiles.find((profile) => profile.id === doc.activeProfileId)
        ?.name;
    })
    .toBe(created);
  const doc = await readState(serviceWorker);
  expect(
    doc.profiles.find((profile) => profile.id === doc.activeProfileId)?.name,
  ).toBe(created);
  expect(doc.profiles.every((profile) => !("enabled" in profile))).toBe(true);
});

test("the popup options button opens the options workspace", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(serviceWorker, createV1Seed());
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // open_in_tab is true, so the options page opens as its own top-level tab
  // rather than in Chrome's embedded dialog. The new page is the options page.
  const [options] = await Promise.all([
    context.waitForEvent("page"),
    popup.getByRole("button", { name: copy.actions.options }).click(),
  ]);
  await options.waitForURL(/\/options\.html/);
  const optionsUrl = new URL(options.url());
  expect(optionsUrl.protocol).toBe("chrome-extension:");
  expect(optionsUrl.host).toBe(extensionId);
  expect(optionsUrl.pathname).toBe("/options.html");
  await expect(options.getByRole("main")).toBeVisible();
});
