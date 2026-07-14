import type { Page, Worker } from "@playwright/test";
import type { StateDoc } from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import { copy } from "../../src/ui/copy";
import { expect, seedState, test } from "../fixtures";

// The inline rule editor has no Save button: it commits or abandons when focus
// leaves its box. A control click must never be mistaken for a focus departure
// — on a fresh profile that tears the editor down and drops the user back on the
// first-run landing screen. This reproduces in a real browser only: clicking a
// <label> (a radio, a segment) blurs the active field before focus lands on the
// wrapped control, so the check must key off where focus *settles*, not the
// mid-flight relatedTarget.

async function openEditor(page: Page, id: string, sw: Worker): Promise<void> {
  const doc: StateDoc = createV1Seed();
  await seedState(sw, doc);
  await page.goto(`chrome-extension://${id}/popup.html`);
  await expect(page.locator(".first-run")).toBeVisible();
  await page.getByRole("button", { name: copy.firstRun.createRule }).click();
  await expect(page.locator(".rule-editor")).toBeVisible();
}

const CONTROLS: ReadonlyArray<{
  name: string;
  act: (page: Page) => Promise<unknown>;
}> = [
  {
    name: "the Response direction radio",
    act: (page) =>
      page
        .locator(".editor-radio", { hasText: copy.editor.direction.response })
        .click(),
  },
  {
    name: "the URL pattern scope segment",
    act: (page) =>
      page
        .locator(".segment", { hasText: copy.editor.scopeType.pattern })
        .click(),
  },
  {
    name: "the Regex scope segment",
    act: (page) =>
      page
        .locator(".segment", { hasText: copy.editor.scopeType.regex })
        .click(),
  },
  {
    name: "the All sites link",
    act: (page) => page.locator(".all-sites").click(),
  },
  {
    name: "the Remove operation",
    act: (page) => page.locator(".editor-select").selectOption("remove"),
  },
];

for (const control of CONTROLS) {
  test(`the editor survives clicking ${control.name}`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 640 });
    await openEditor(page, extensionId, serviceWorker);

    await control.act(page);

    await expect(page.locator(".rule-editor")).toBeVisible();
    await expect(page.locator(".first-run")).toBeHidden();
  });
}
