import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { StateDoc } from "../../src/core/model";
import { copy, siteAccessCopy } from "../../src/ui/copy";
import { NARROWED_ORIGIN } from "../echo-ports.mjs";
import { expect, seedState, stateWithRules, test } from "../fixtures";
import { pathologicalDoc } from "../fixtures/pathological";
import {
  collectLayoutOffenders,
  describeOffenders,
  TOLERANCE,
} from "../lib/layout-sweep";
import {
  OPTIONS_HOST,
  OPTIONS_ROUTES,
  OPTIONS_WIDTHS,
  openPopupOnHost,
  POPUP,
  popupUrl,
  THEMES,
  type Theme,
  withTheme,
} from "../lib/pathological-surfaces";

// The deterministic, design-agnostic layout gate. Under one pathological content
// seed (long JWT, URL value, non-Latin plus emoji, long header name, long and
// punycode domains, long profile names, about fifteen rules over several sites),
// every popup state and every options route is measured against three physical
// invariants: nothing escapes the fixed surface, nothing is clipped without a
// sanctioned truncation recovery, and every exposed control is actually
// reachable. None of these encodes a pixel, colour, font, or markup shape, so a
// green run is a licence to redesign boldly, not a freeze of the current design.
//
// Geometry is only real in a layout engine: happy-dom stubs every rect to zero,
// so this lives in Playwright/Chromium, the extension's own render target.

// Chrome draws the popup in a fixed ~398px window; that width is a platform
// bound, not a style. Options is responsive, measured across a small registry
// whose narrow floor sits at 360, below the shell's 720px reflow to a top rail,
// with 768px and 1280px above it.

const ALL_WARNINGS_FIXTURE = fileURLToPath(
  new URL("../fixtures/modheader-all-warnings.json", import.meta.url),
);

// The reachability roster: every role that names an operable control. Enumerated
// by role with no name filter, so the check follows the design as markup shifts.
const INTERACTIVE_ROLES = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "switch",
  "combobox",
  "radio",
  "menuitem",
  "tab",
  "slider",
] as const;

function paused(doc: StateDoc): StateDoc {
  return { ...doc, settings: { ...doc.settings, paused: true } };
}

const optionsUrl = (extensionId: string, hash: string) =>
  `chrome-extension://${extensionId}/options.html#${hash}`;

// Freeze transitions to their resting state and let web-font metrics settle
// before measuring, so a control is never read mid-animation or before its font
// has loaded. Two frames flush the truncation primitive's resize-driven recut.
async function settle(page: Page, theme: Theme): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// Escape and clip: read per-element rects and computed styles, and assert
// nothing escapes the surface and nothing is clipped without recovery.
async function sweep(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(collectLayoutOffenders, TOLERANCE);
  // Name the culprit elements first, then the document-level summary.
  expect(
    result.pastSurface,
    describeOffenders(label, "elements past the surface", result.pastSurface),
  ).toEqual([]);
  const docOverflow = result.documentScrollWidth - result.surfaceWidth;
  expect(
    docOverflow,
    `${label}: document scrolls horizontally by ${docOverflow}px past the ${result.surfaceWidth}px surface`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    result.clipped,
    describeOffenders(label, "unrecoverable clips", result.clipped),
  ).toEqual([]);
}

// Reach: every visible, enabled control is actionable. Trial click runs the full
// actionability hit-test (visible, stable, receives events, not obscured)
// without clicking, and throws naming the control if it is buried or off-screen,
// a class of defect the escape and clip rect math cannot see.
async function reachable(page: Page): Promise<void> {
  for (const role of INTERACTIVE_ROLES) {
    for (const control of await page.getByRole(role).all()) {
      if (!(await control.isVisible()) || !(await control.isEnabled())) {
        continue;
      }
      // A visually-hidden native input (sr-only, a 1px box) is driven through
      // its visible label and the keyboard, never a direct pointer hit, so it is
      // not a pointer target and keyboard.spec proves that path. Only real
      // pointer targets are trial-clicked.
      const box = await control.boundingBox();
      if (box === null || box.width < 4 || box.height < 4) continue;
      await control.click({ trial: true, timeout: 2000 });
    }
  }
}

async function measure(page: Page, theme: Theme, label: string): Promise<void> {
  // Chromium throttles requestAnimationFrame in a background tab, and both the
  // settle below and every trial click wait on frames, so a measurement costs a
  // throttled frame per control. The real popup is drawn over the foreground
  // tab, never behind one, so the front is also the faithful place to measure.
  await page.bringToFront();
  await settle(page, theme);
  await test.step(label, async () => {
    await sweep(page, label);
    await reachable(page);
  });
}

test("popup no-host states hold their surface under pathological content", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  for (const theme of THEMES) {
    const doc = pathologicalDoc(OPTIONS_HOST);

    await seedState(serviceWorker, withTheme(doc, theme));
    const firstRun = await context.newPage();
    await firstRun.setViewportSize(POPUP);
    await firstRun.emulateMedia({ reducedMotion: "reduce" });
    await firstRun.bringToFront();
    await firstRun.goto(popupUrl(extensionId));
    await expect(firstRun.getByText(copy.readout.noHost)).toBeVisible();
    await measure(firstRun, theme, `popup no-host (${theme})`);
    await firstRun.close();

    await seedState(serviceWorker, withTheme(paused(doc), theme));
    const pausedPage = await context.newPage();
    await pausedPage.setViewportSize(POPUP);
    await pausedPage.emulateMedia({ reducedMotion: "reduce" });
    await pausedPage.bringToFront();
    await pausedPage.goto(popupUrl(extensionId));
    await expect(
      pausedPage
        .getByRole("status")
        .filter({ hasText: copy.readout.pausedBanner }),
    ).toBeVisible();
    await measure(pausedPage, theme, `popup paused no-host (${theme})`);
    await pausedPage.close();
  }
});

test("popup populated states hold their surface under pathological content", {
  tag: "@host-access",
}, async ({ context, echoServers, extensionId, serviceWorker }) => {
  const host = new URL(echoServers.h1Url).hostname;
  const web = await context.newPage();
  await web.goto(`${echoServers.h1Url}/layout`);

  for (const theme of THEMES) {
    const doc = pathologicalDoc(host);

    const populated = await openPopupOnHost({
      context,
      extensionId,
      foregroundPage: web,
      serviceWorker,
      doc,
      theme,
      reducedMotion: true,
    });
    await expect(
      populated.getByRole("region", { name: copy.readout.direction.request }),
    ).toBeVisible();
    await expect(
      populated.getByRole("region", { name: copy.readout.direction.response }),
    ).toBeVisible();
    await measure(populated, theme, `popup populated (${theme})`);

    await populated
      .getByRole("button", { name: copy.readout.addChange })
      .first()
      .click();
    await expect(populated.getByRole("dialog")).toBeVisible();
    await measure(populated, theme, `popup rule editor (${theme})`);
    await populated.close();

    const composer = await openPopupOnHost({
      context,
      extensionId,
      foregroundPage: web,
      serviceWorker,
      doc,
      theme,
      reducedMotion: true,
    });
    await composer
      .getByRole("button", { name: copy.readout.justThisTab })
      .click();
    await expect(
      composer.getByRole("region", { name: copy.readout.newChange }),
    ).toBeVisible();
    await measure(composer, theme, `popup this-tab composer (${theme})`);
    await composer.close();

    const pausedPage = await openPopupOnHost({
      context,
      extensionId,
      foregroundPage: web,
      serviceWorker,
      doc: paused(doc),
      theme,
      reducedMotion: true,
    });
    await expect(
      pausedPage
        .getByRole("status")
        .filter({ hasText: copy.readout.pausedBanner }),
    ).toBeVisible();
    await expect(
      pausedPage.getByRole("region", { name: copy.readout.direction.request }),
    ).toBeVisible();
    await measure(pausedPage, theme, `popup populated paused (${theme})`);
    await pausedPage.close();
  }

  await web.close();
});

test("partial site-access rows hold their surface", {
  tag: "@narrow-host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  // This build's declared narrow permission is the partial grant under test.
  expect(
    await serviceWorker.evaluate(async () => {
      const permissions = await chrome.permissions.getAll();
      return permissions.origins ?? [];
    }),
  ).toEqual([NARROWED_ORIGIN]);

  const doc = stateWithRules([
    {
      direction: "request",
      operation: "set",
      header: "x-layout",
      value: "1",
      scope: { type: "domains", domains: ["localhost"] },
      resourceTypes: ["xhr"],
      initiators: [],
      enabled: true,
    },
  ]);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const theme of THEMES) {
    await seedState(serviceWorker, withTheme(doc, theme));
    for (const width of OPTIONS_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(optionsUrl(extensionId, "site-access"));
      await expect(
        page.getByRole("list", { name: siteAccessCopy.partialHeading }),
      ).toBeVisible();
      await measure(
        page,
        theme,
        `options partial site access @${width} (${theme})`,
      );
    }
  }

  await page.close();
});

async function sweepOptions(
  page: Page,
  extensionId: string,
  theme: Theme,
): Promise<void> {
  for (const width of OPTIONS_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const { hash, title } of OPTIONS_ROUTES) {
      await page.goto(optionsUrl(extensionId, hash));
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      await measure(page, theme, `options ${hash} @${width} (${theme})`);
    }

    // The pre-apply import summary with its itemized warnings, a distinct
    // options surface reached by picking a file.
    await page.goto(optionsUrl(extensionId, "import-export"));
    await page
      .locator('input[type="file"]')
      .setInputFiles(ALL_WARNINGS_FIXTURE);
    await expect(page.locator(".import-summary")).toBeVisible();
    await measure(page, theme, `options import summary @${width} (${theme})`);
  }
}

for (const theme of THEMES) {
  test(`options routes hold their surface under pathological content (${theme})`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedState(
      serviceWorker,
      withTheme(pathologicalDoc(OPTIONS_HOST), theme),
    );
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await sweepOptions(page, extensionId, theme);
    await page.close();
  });
}
