import type { Page } from "@playwright/test";
import type { Tone } from "../../src/ui/dispositionCopy";
import {
  expect,
  openPopup,
  seedState,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

const TONE_KEYS = {
  live: true,
  doubt: true,
  amber: true,
  stop: true,
  rest: true,
} as const satisfies Record<Tone, true>;

const TONES = Object.keys(TONE_KEYS) as Tone[];

async function toneColors(
  page: Page,
  rowClass: "change-line" | "fleet-row",
  elementClass: "spine" | "op",
): Promise<string[]> {
  return page.evaluate(
    ({ rowClass, elementClass, tones }) => {
      const fixture = document.createElement("div");
      fixture.innerHTML = tones
        .map(
          (tone) =>
            `<div class="${rowClass} ${tone}"><span class="${elementClass}"></span></div>`,
        )
        .join("");
      document.body.append(fixture);
      const colors = [
        ...fixture.querySelectorAll<HTMLElement>(`.${elementClass}`),
      ].map((element) =>
        elementClass === "spine"
          ? getComputedStyle(element).backgroundColor
          : getComputedStyle(element).color,
      );
      fixture.remove();
      return colors;
    },
    { rowClass, elementClass, tones: TONES },
  );
}

// Three correctness questions the unit runner cannot see, because each turns on
// the real CSS cascade: a base card recipe beating its row modifier by bundle
// emit order, a tone the stylesheets never name falling through to the running
// hue, and a popup change row painting a whole-row hover highlight it has no
// click to justify. Only a real browser resolves them, so this reads resolved
// layout, colour, and hover. Each fails only if its specific defect returns.

test("@host-access the all-sites card lays out as a row, not a centred column", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#site-access`);
  const card = page.locator(".sa-all-on");
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).flexDirection)).toBe(
    "row",
  );
});

test("@host-access every rule tone paints its own spine on both row surfaces", async ({
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
        header: "x-live",
        value: "on",
        scope: { type: "domains", domains: ["example.com"] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
      {
        direction: "request",
        operation: "set",
        header: "x-per-request",
        value: "on",
        scope: {
          type: "regex",
          regex: "example\\.com",
          hosts: ["example.com"],
        },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#rules`);
  await expect(page.locator(".fleet-row.doubt")).toBeVisible();

  expect(new Set(await toneColors(page, "fleet-row", "spine")).size).toBe(
    TONES.length,
  );
  expect(new Set(await toneColors(page, "fleet-row", "op")).size).toBe(
    TONES.length,
  );

  const popup = await context.newPage();
  await openPopup(popup, extensionId, serviceWorker, stateWithRules([]));
  expect(new Set(await toneColors(popup, "change-line", "spine")).size).toBe(
    TONES.length,
  );
  expect(new Set(await toneColors(popup, "change-line", "op")).size).toBe(
    TONES.length,
  );
});

// A popup change row carries only the controls it truly has: a value-edit
// button, a toggle, and a grant or a remove. The row itself opens nothing, so a
// full-width hover highlight would advertise a row click it never answers. This
// drives the populated popup over a granted host and reads the hovered row's
// background: it stays transparent, and turns a colour only if the whole-row
// hover returns.
test("@host-access a populated popup change row shows no whole-row hover highlight", async ({
  context,
  echoServers,
  extensionId,
  serviceWorker,
}) => {
  const host = new URL(echoServers.h1Url).hostname;
  await seedStateAndWait(
    serviceWorker,
    stateWithRules([
      {
        direction: "request",
        operation: "set",
        header: "x-hover",
        value: "on",
        scope: { type: "domains", domains: [host] },
        resourceTypes: "all",
        initiators: [],
        enabled: true,
      },
    ]),
  );

  const web = await context.newPage();
  await web.goto(`${echoServers.h1Url}/hover`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  // newPage steals focus to the popup, so its first mount reads no host;
  // fronting the web tab and reloading re-mounts it over the echo host.
  await web.bringToFront();
  await popup.reload();

  const row = popup.locator(".change-line").first();
  await expect(row).toBeVisible();
  await row.hover();
  expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgba(0, 0, 0, 0)",
  );
});
