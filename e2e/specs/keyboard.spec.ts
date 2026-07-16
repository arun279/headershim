import type { Page, Worker } from "@playwright/test";
import {
  createProfile,
  createRule,
  type RuleDraft,
  type StateDoc,
} from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import { copy } from "../../src/ui/copy";
import { expect, seedState, test } from "../fixtures";

// The popup half: every in-popup binding driven through real key
// events against the built popup. The global commands (Alt+Shift+…) are the
// browser's own shortcut manager dispatching chrome.commands and cannot be
// synthesized by Playwright or CDP. Their application-side command handlers
// run in src/test/background.test.ts.

function baseDoc(over: Partial<StateDoc["settings"]> = {}): StateDoc {
  let doc = createV1Seed();
  const build = (draft: Partial<RuleDraft>) => {
    const [rule, next] = createRule(doc, {
      direction: "request",
      operation: "set",
      header: "x-a",
      value: "1",
      scope: { type: "domains", domains: ["example.com"] },
      resourceTypes: ["xhr"],
      initiators: [],
      enabled: true,
      ...draft,
    });
    doc = next;
    return rule;
  };
  const a = build({ header: "x-a" });
  const b = build({ header: "x-b" });
  const primary = {
    ...createProfile({
      name: "Default",
      badgeText: "DE",
      color: "indigo",
      enabled: true,
    }),
    rules: [a, b],
  };
  const local = {
    ...createProfile({
      name: "Local",
      badgeText: "LO",
      color: "teal",
      enabled: false,
    }),
    rules: [],
  };
  return {
    ...doc,
    profiles: [primary, local],
    focusedProfileId: primary.id,
    settings: { ...doc.settings, ...over },
  };
}

async function openPopup(
  page: Page,
  extensionId: string,
  serviceWorker: Worker,
  doc: StateDoc,
): Promise<void> {
  await seedState(serviceWorker, doc);
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator(".rule-row").first()).toBeVisible();
}

const chips = (page: Page) => page.locator(".profiles .chip");
const profileChips = (page: Page) => page.locator(".profiles .profile-chip");
const rows = (page: Page) => page.locator(".rule-row");

// A popup command lands through storage write → background reconcile →
// storage.onChanged → re-render, so the rendered result is eventually
// consistent. On a contended CI runner that round trip can outrun the default
// 10s expect budget; assertions that observe a mutation reflected in the popup
// poll the real rendered state with a wider ceiling instead.
const RENDER_TIMEOUT = 15_000;

function firstRuleValue(serviceWorker: Worker): Promise<string | undefined> {
  return serviceWorker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    return (state as StateDoc | undefined)?.profiles[0]?.rules[0]?.value;
  });
}

test("single-letter commands open their surfaces", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();

  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("n");
  await expect(page.locator(".rule-editor")).toBeVisible();

  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("t");
  await expect(page.locator(".this-tab")).toBeVisible();

  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("v");
  await expect(page.locator(".verify-inline-result")).toBeVisible();

  // p toggles global pause: the annunciator flips to the paused tier.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("p");
  await expect(page.locator('.annunciator[data-state="paused"]')).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });

  await page.close();
});

test("digit keys switch and toggle profiles", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();

  // 2 activates the second profile exclusively: it takes focus, the first turns off.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("Digit2");
  await expect(chips(page).nth(1)).toHaveAttribute("aria-current", "true", {
    timeout: RENDER_TIMEOUT,
  });
  await expect(profileChips(page).nth(1)).not.toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });
  await expect(profileChips(page).first()).toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });

  // Shift+2 toggles the second on without turning the first off.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("Shift+Digit2");
  await expect(profileChips(page).nth(1)).not.toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });
  await expect(profileChips(page).first()).not.toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });

  await page.close();
});

test("rule-row keys move focus and act on the focused row", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();

  // Arrow keys walk the roving focus down and back up the list.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await rows(page).first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows(page).first()).toBeFocused();

  // Enter opens the editor for the focused row.
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();

  // Space toggles the focused row off.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await rows(page).first().focus();
  await page.keyboard.press(" ");
  await expect(rows(page).first()).toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });

  // Delete removes the focused row (2 → 1) and offers undo.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await expect(rows(page)).toHaveCount(2);
  await rows(page).first().focus();
  await page.keyboard.press("Delete");
  await expect(rows(page)).toHaveCount(1, { timeout: RENDER_TIMEOUT });
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible();
  await expect(
    toast.getByRole("button", { name: copy.actions.undo }),
  ).toBeVisible();

  await page.close();
});

test("editor keys respect field semantics and guard dirty drafts", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();

  // Value is a real textarea. Plain Enter belongs to the field and neither
  // saves nor closes the editor; a single-line field keeps the explicit Enter
  // accelerator.
  const base = baseDoc();
  const allScoped: StateDoc = {
    ...base,
    profiles: base.profiles.map((profile, index) =>
      index === 0
        ? {
            ...profile,
            rules: profile.rules.map((rule, ruleIndex) =>
              ruleIndex === 0 ? { ...rule, scope: { type: "all" } } : rule,
            ),
          }
        : profile,
    ),
  };
  await openPopup(page, extensionId, serviceWorker, allScoped);
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  const value = page.getByRole("textbox", { name: copy.editor.labels.value });
  await expect(value).toHaveJSProperty("tagName", "TEXTAREA");
  await value.fill("not-yet-committed");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  expect(await firstRuleValue(serviceWorker)).toBe("1");
  await expect(value).toHaveValue("not-yet-committed");

  await page
    .getByRole("combobox", { name: copy.editor.labels.headerName })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeHidden();
  expect(await firstRuleValue(serviceWorker)).toBe("not-yet-committed");

  // Ctrl/Cmd+Enter uses the same explicit commit path from the textarea.
  await openPopup(page, extensionId, serviceWorker, allScoped);
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  await page
    .getByRole("textbox", { name: copy.editor.labels.value })
    .fill("committed-on-cmd");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".rule-editor")).toBeHidden();
  expect(await firstRuleValue(serviceWorker)).toBe("committed-on-cmd");

  // Esc on a dirty draft asks before discarding. A second Esc keeps editing;
  // choosing Discard closes the editor, and only then can Esc close the popup.
  await openPopup(page, extensionId, serviceWorker, allScoped);
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  await page
    .getByRole("textbox", { name: copy.editor.labels.value })
    .fill("dirty-draft");
  await page.keyboard.press("Escape");
  await expect(
    page.getByText(copy.editor.discardConfirm.title, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: copy.editor.discardConfirm.keepEditing,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByText(copy.editor.discardConfirm.title, { exact: true }),
  ).toBeHidden();

  await page.keyboard.press("Escape");
  const discard = page.getByRole("button", {
    name: copy.editor.discardConfirm.discard,
    exact: true,
  });
  await discard.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeHidden();
  await rows(page).first().focus();
  const closed = page.waitForEvent("close");
  // The keypress runs window.close() synchronously, which can tear the page
  // down before press() resolves; the close event is the assertion.
  await page.keyboard.press("Escape").catch(() => {});
  await closed;
});

test("options rules can be created and edited from the keyboard", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedState(serviceWorker, createV1Seed());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#profiles`);

  const newRule = page.getByRole("button", {
    name: copy.options.rules.new,
  });
  await expect(newRule).toBeVisible();
  await newRule.focus();
  await page.keyboard.press("Enter");

  const createDialog = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await expect(createDialog).toBeVisible();
  const name = createDialog.getByRole("combobox", {
    name: copy.editor.labels.headerName,
  });
  await expect(name).toBeFocused();
  await page.keyboard.type("x-options-keyboard");
  await createDialog
    .getByRole("textbox", { name: copy.editor.labels.value })
    .fill("created");
  const domain = createDialog.getByRole("textbox", {
    name: copy.editor.domainInputLabel,
  });
  await domain.fill("example.com");
  await domain.press("Enter");
  await expect(createDialog.locator(".domain-chip .mono")).toHaveText(
    "example.com",
  );
  await createDialog.getByRole("radio", { name: copy.editor.allSites }).check();

  const create = createDialog.getByRole("button", {
    name: copy.actions.createRule,
  });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(createDialog).toBeHidden();

  await expect.poll(() => firstRuleValue(serviceWorker)).toBe("created");
  const row = page.locator(".rule-row").first();
  await expect(row).toHaveClass(/\bblocked\b/);
  await row.focus();
  await page.keyboard.press("Enter");

  const editDialog = page.getByRole("dialog", {
    name: copy.editor.heading("edit", "Default"),
  });
  await expect(editDialog).toBeVisible();
  await editDialog
    .getByRole("textbox", { name: copy.editor.labels.value })
    .fill("edited");
  const save = editDialog.getByRole("button", {
    name: copy.actions.saveChanges,
  });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(editDialog).toBeHidden();
  await expect.poll(() => firstRuleValue(serviceWorker)).toBe("edited");
});
