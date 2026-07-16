import type { Worker } from "@playwright/test";
import type { StateDoc } from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import { copy } from "../../src/ui/copy";
import { expect, seedState, test } from "../fixtures";

async function readState(worker: Worker): Promise<StateDoc> {
  return worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    return state as StateDoc;
  });
}

async function ruleCount(worker: Worker): Promise<number> {
  const doc = await readState(worker);
  return doc.profiles.reduce(
    (total, profile) => total + profile.rules.length,
    0,
  );
}

test("editor controls never save or leave the sheet by themselves", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(serviceWorker, createV1Seed());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole("button", { name: copy.firstRun.createRule }).click();

  const editor = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await expect(editor).toBeVisible();
  await expect(page.locator(".popup-head")).toHaveCount(0);
  await expect(page.locator(".first-run")).toHaveCount(0);

  const name = editor.getByRole("combobox", {
    name: copy.editor.labels.headerName,
  });
  await name.fill("x-explicit-only");

  await editor
    .getByRole("radio", { name: copy.editor.direction.response })
    .click();
  await expect(
    editor.getByRole("radio", { name: copy.editor.direction.response }),
  ).toBeChecked();
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  const operation = editor.getByRole("radio", {
    name: copy.editor.operation.remove,
  });
  await editor
    .locator("label.segment", { hasText: copy.editor.operation.remove })
    .click();
  await expect(operation).toBeChecked();
  await expect(
    editor.getByRole("textbox", { name: copy.editor.labels.value }),
  ).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  await editor
    .locator("label.segment", { hasText: copy.editor.scopeType.pattern })
    .click();
  await expect(
    editor.getByRole("radio", { name: copy.editor.scopeType.pattern }),
  ).toBeChecked();
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  await editor
    .locator("label.segment", { hasText: copy.editor.scopeType.regex })
    .click();
  await expect(
    editor.getByRole("radio", { name: copy.editor.scopeType.regex }),
  ).toBeChecked();
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  const allSites = editor.getByRole("radio", {
    name: copy.editor.allSites,
  });
  await editor
    .locator("label.segment", { hasText: copy.editor.allSites })
    .click();
  await expect(allSites).toBeChecked();
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  const resourceTypes = editor.getByRole("button", {
    name: `${copy.editor.labels.resourceTypes} · ${copy.editor.allTypes}`,
  });
  await resourceTypes.click();
  await expect(resourceTypes).toHaveAttribute("aria-expanded", "true");
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  const pages = editor.getByRole("checkbox", {
    name: copy.resourceTypes.groups.pages,
  });
  await editor
    .locator("label.rt-item", { hasText: copy.resourceTypes.groups.pages })
    .click();
  await expect(pages).not.toBeChecked();
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  await editor
    .getByRole("button", { name: copy.actions.cancel, exact: true })
    .click();
  await expect(
    editor.getByText(copy.editor.discardConfirm.title, { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", {
      name: copy.editor.discardConfirm.discard,
      exact: true,
    })
    .click();
  await expect(editor).toBeHidden();
  await expect(page.locator(".first-run")).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);
});

// Runs against the static host-access build: with all-sites already granted the
// primary is a plain "Create rule" that commits and closes in one gesture, so
// the test exercises the save path without Chrome's native permission prompt
// (which cannot be answered in headless). The no-save-on-control guarantees are
// unchanged.
test("Create rule is the only pointer action that saves a draft", {
  tag: "@host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  await seedState(serviceWorker, createV1Seed());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole("button", { name: copy.firstRun.createRule }).click();

  const editor = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await editor
    .getByRole("combobox", { name: copy.editor.labels.headerName })
    .fill("x-created-explicitly");
  const value = editor.getByRole("textbox", {
    name: copy.editor.labels.value,
  });
  await expect(value).toHaveJSProperty("tagName", "TEXTAREA");
  await expect(value).toHaveClass(/\bcompose-value-input\b/);
  await value.fill("created");
  await editor
    .locator("label.segment", { hasText: copy.editor.allSites })
    .click();
  await expect(
    editor.getByRole("radio", { name: copy.editor.allSites }),
  ).toBeChecked();

  // Moving focus and clicking inert editor chrome are ordinary draft actions.
  // Neither is permission to save.
  await value.focus();
  await editor.getByRole("radio", { name: copy.editor.operation.set }).focus();
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);
  await editor.locator(".editor-title").click();
  await expect(editor).toBeVisible();
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  await editor
    .getByRole("button", { name: copy.actions.createRule, exact: true })
    .click();
  await expect(editor).toBeHidden();
  await expect(page.locator(".rule-row")).toHaveCount(1);
  await expect.poll(() => ruleCount(serviceWorker)).toBe(1);

  const doc = await readState(serviceWorker);
  expect(doc.profiles[0]?.rules[0]).toMatchObject({
    header: "x-created-explicitly",
    value: "created",
    scope: { type: "all" },
  });
});

// Host-access build so the commit chord closes on an already-granted scope; the
// plain-Enter-does-not-commit guarantee is the point and is unchanged.
test("plain Enter stays in Value while the commit chord creates the rule", {
  tag: "@host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  await seedState(serviceWorker, createV1Seed());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole("button", { name: copy.firstRun.createRule }).click();

  const editor = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await editor
    .getByRole("combobox", { name: copy.editor.labels.headerName })
    .fill("x-created-by-chord");
  const value = editor.getByRole("textbox", {
    name: copy.editor.labels.value,
  });
  await expect(value).toHaveJSProperty("tagName", "TEXTAREA");
  await expect(value).toHaveClass(/\bcompose-value-input\b/);
  await value.fill("chord");
  await editor
    .locator("label.segment", { hasText: copy.editor.allSites })
    .click();
  await expect(
    editor.getByRole("radio", { name: copy.editor.allSites }),
  ).toBeChecked();

  await value.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await expect(value).toHaveValue("chord");
  await expect.poll(() => ruleCount(serviceWorker)).toBe(0);

  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editor).toBeHidden();
  await expect(page.locator(".rule-row")).toHaveCount(1);
  await expect.poll(() => ruleCount(serviceWorker)).toBe(1);
});
