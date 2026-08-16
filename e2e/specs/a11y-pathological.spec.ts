import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { copy } from "../../src/ui/copy";
import { expect, seedState, test } from "../fixtures";
import { pathologicalDoc } from "../fixtures/pathological";
import {
  OPTIONS_HOST,
  OPTIONS_ROUTES,
  OPTIONS_WIDTHS,
  openPopupOnHost,
  THEMES,
  type Theme,
  withTheme,
} from "../lib/pathological-surfaces";

// Naming and contrast coverage under the pathological seed. a11y.spec runs the
// WCAG A/AA tag set on the canonical seed at the default viewport; this suite
// runs a focused subset under heavy-user content across the options width
// registry, because a long value can change which token paints where, and a
// 70-char header name or an 800-char value can blank a control's computed name.
// Kept separate from the layout sweep so each suite fails for its own reason and
// runtime stays bounded.

// Contrast plus a non-empty accessible name for the listed interactive roles
// and form controls. The suite runs this focused subset so it stays the
// naming/contrast gate, and so contrast is the only expensive rule it runs.
const RULES = [
  "color-contrast",
  "button-name",
  "link-name",
  "input-button-name",
  "aria-command-name",
  "aria-input-field-name",
  "aria-toggle-field-name",
  "aria-tooltip-name",
  "label",
  "select-name",
];

async function analyze(
  page: Page,
  surface: string,
  theme: Theme,
): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.fonts.ready);
  const { violations } = await new AxeBuilder({ page })
    .withRules(RULES)
    .analyze();
  expect(
    violations,
    `${surface}: ${violations
      .map((violation) => `${violation.id} (${violation.nodes.length})`)
      .join(", ")}`,
  ).toEqual([]);
}

test("populated popup keeps names and contrast under pathological content", {
  tag: "@host-access",
}, async ({ context, echoServers, extensionId, serviceWorker }) => {
  const host = new URL(echoServers.h1Url).hostname;
  const web = await context.newPage();
  await web.goto(`${echoServers.h1Url}/a11y-pathological`);

  for (const theme of THEMES) {
    const doc = pathologicalDoc(host);

    const populated = await openPopupOnHost({
      context,
      extensionId,
      foregroundPage: web,
      serviceWorker,
      doc,
      theme,
    });
    await expect(
      populated.getByRole("region", { name: copy.readout.direction.request }),
    ).toBeVisible();
    await analyze(populated, `popup populated (${theme})`, theme);

    await populated
      .getByRole("button", { name: copy.readout.addChange })
      .first()
      .click();
    await expect(populated.getByRole("dialog")).toBeVisible();
    await analyze(populated, `popup rule editor (${theme})`, theme);
    await populated.close();

    const composer = await openPopupOnHost({
      context,
      extensionId,
      foregroundPage: web,
      serviceWorker,
      doc,
      theme,
    });
    await composer
      .getByRole("button", { name: copy.readout.justThisTab })
      .click();
    await expect(
      composer.getByRole("region", { name: copy.readout.newChange }),
    ).toBeVisible();
    await analyze(composer, `popup this-tab composer (${theme})`, theme);
    await composer.close();
  }

  await web.close();
});

for (const theme of THEMES) {
  test(`options keeps names and contrast under pathological content (${theme})`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedState(
      serviceWorker,
      withTheme(pathologicalDoc(OPTIONS_HOST), theme),
    );
    const page = await context.newPage();
    for (const width of OPTIONS_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const { hash, title } of OPTIONS_ROUTES) {
        await page.goto(
          `chrome-extension://${extensionId}/options.html#${hash}`,
        );
        await expect(
          page.getByRole("heading", { level: 1, name: title }),
        ).toBeVisible();
        await analyze(page, `options ${hash} @${width} (${theme})`, theme);
      }
    }
    await page.close();
  });
}
