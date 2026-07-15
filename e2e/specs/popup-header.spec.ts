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

  await page
    .getByRole("button", { name: copy.options.profiles.newName, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: copy.options.profiles.newName,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: copy.options.profiles.nameLabel })
    .fill("Staging");
  await dialog.getByRole("button", { name: copy.profiles.create }).click();

  const staging = page.locator(".profile-chip", { hasText: "Staging" });
  await expect(staging.locator(".chip")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(staging).not.toHaveClass(/\boff\b/);
  await expect(
    page.locator(".profile-chip", { hasText: "Default" }),
  ).toHaveClass(/\boff\b/);
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
      return doc.profiles.find((profile) => profile.id === doc.focusedProfileId)
        ?.name;
    })
    .toBe("Staging");
  const doc = await readState(serviceWorker);
  expect(
    doc.profiles.filter((profile) => profile.enabled).map((p) => p.name),
  ).toEqual(["Staging"]);
});

test("the popup theme control updates the current page in place", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const seed = createV1Seed();
  await seedState(serviceWorker, {
    ...seed,
    settings: { ...seed.settings, theme: "light" },
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const marker = await page.evaluate(() => {
    const value = crypto.randomUUID();
    (
      window as Window & { __headershimThemeMarker?: string }
    ).__headershimThemeMarker = value;
    return value;
  });
  const url = page.url();

  await page
    .getByRole("button", { name: copy.options.settings.theme.label })
    .click();
  await page
    .getByRole("menuitemradio", {
      name: copy.options.settings.theme.options.dark,
    })
    .click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".popup-head")).toBeVisible();
  expect(page.url()).toBe(url);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __headershimThemeMarker?: string })
          .__headershimThemeMarker,
    ),
  ).toBe(marker);
  await expect
    .poll(() => readState(serviceWorker).then((doc) => doc.settings.theme))
    .toBe("dark");
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
  await expect(options.locator(".profiles-workspace")).toBeVisible();
});
