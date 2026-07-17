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
    }),
    rules: [a, b],
  };
  const local = {
    ...createProfile({
      name: "Local",
      badgeText: "LO",
      color: "teal",
    }),
    rules: [],
  };
  return {
    ...doc,
    profiles: [primary, local],
    activeProfileId: primary.id,
    settings: { ...doc.settings, ...over },
  };
}

// The first rule scoped to all-sites: on the static host-access build that scope
// is already granted, so the editor's commit chord closes with no permission
// prompt and the editor key semantics can be exercised on their own.
function allScopedDoc(): StateDoc {
  const base = baseDoc();
  return {
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

// Each in-popup command is exercised on its own freshly opened popup. A real
// popup is a brand-new document every time the user opens it; reusing one page
// to re-seed a different document and re-navigate races the popup's own initial
// read of storage, so the commands are split one-per-open rather than batched.

test("the new-rule shortcut opens the editor", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("n");
  await expect(page.locator(".rule-editor")).toBeVisible();
});

test("the temporary-override shortcut opens the composer", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("t");
  // The popup opens on the extension page, which has no web origin to bind an
  // override to, so the composer surfaces its no-host state.
  await expect(page.locator(".this-tab-note")).toBeVisible();
});

test("a digit key focuses a profile without enabling it", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();

  // 2 changes only which profile is focused. Local stays off and Default stays
  // on, so merely inspecting a profile cannot change live traffic.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("Digit2");
  await expect(chips(page).nth(1)).toHaveAttribute("aria-current", "true", {
    timeout: RENDER_TIMEOUT,
  });
  await expect(profileChips(page).nth(1)).toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });
  await expect(profileChips(page).first()).not.toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });
  await expect(profileChips(page).first().getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(profileChips(page).nth(1).getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("Shift+digit enables a profile without moving focus", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();

  // Shift+2 is the explicit keyboard enable path. It turns Local on without
  // turning Default off or moving focus away from Default.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("Shift+Digit2");
  await expect(profileChips(page).nth(1)).not.toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });
  await expect(profileChips(page).first()).not.toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });
  await expect(chips(page).first()).toHaveAttribute("aria-current", "true");
  await expect(chips(page).nth(1)).not.toHaveAttribute("aria-current", "true");
  await expect(profileChips(page).first().getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(profileChips(page).nth(1).getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

// The rule-row keys, one behaviour per freshly seeded popup (Space and Delete
// mutate storage, so they must not race a re-seed of a reused page).

test("arrow keys move roving focus and Enter opens the editor", async ({
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
});

test("Space toggles the focused row off", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await rows(page).first().focus();
  await page.keyboard.press(" ");
  await expect(rows(page).first()).toHaveClass(/\boff\b/, {
    timeout: RENDER_TIMEOUT,
  });
});

test("Delete removes the focused row and offers undo", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();

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
});

// The editor key-semantics coverage is split one popup per behaviour: like the
// single-letter commands above, each behaviour opens its own freshly seeded
// popup so nothing races a re-seed of a reused page. All four run on the static
// host-access build so the seeded all-sites rule's commit chord closes with no
// native permission prompt.

// Plain Enter belongs to the field and never saves or closes the editor, from
// the value textarea or from another field; the chord is the keyboard save path.
test("plain Enter stays in a field while the commit chord saves", {
  tag: "@host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, allScopedDoc());
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  const value = page.getByRole("textbox", { name: copy.editor.labels.value });
  await expect(value).toHaveJSProperty("tagName", "TEXTAREA");
  await expect(value).toHaveClass(/\bvalue-input\b/);
  await value.fill("not-yet-committed");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  expect(await firstRuleValue(serviceWorker)).toBe("1");
  await expect(value).toHaveValue("not-yet-committed");

  await page
    .getByRole("combobox", { name: copy.editor.labels.headerName })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  expect(await firstRuleValue(serviceWorker)).toBe("1");

  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".rule-editor")).toBeHidden();
  expect(await firstRuleValue(serviceWorker)).toBe("not-yet-committed");
});

// The chord commits from the value textarea too.
test("the commit chord saves from the value textarea", {
  tag: "@host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, allScopedDoc());
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  await page
    .getByRole("textbox", { name: copy.editor.labels.value })
    .fill("committed-on-cmd");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".rule-editor")).toBeHidden();
  expect(await firstRuleValue(serviceWorker)).toBe("committed-on-cmd");
});

// Esc on an untouched draft closes directly and commits nothing.
test("Esc on a clean draft closes without committing", {
  tag: "@host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, allScopedDoc());
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".rule-editor")).toBeHidden();
  expect(await firstRuleValue(serviceWorker)).toBe("1");
});

// Esc on a dirty draft asks before discarding. A second Esc keeps editing;
// choosing Discard closes the editor committing nothing, and only then can Esc
// close the popup.
test("Esc on a dirty draft guards with a discard prompt", {
  tag: "@host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, allScopedDoc());
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
  expect(await firstRuleValue(serviceWorker)).toBe("1");
  await rows(page).first().focus();
  const closed = page.waitForEvent("close");
  // The keypress runs window.close() synchronously, which can tear the page
  // down before press() resolves; the close event is the assertion.
  await page.keyboard.press("Escape").catch(() => {});
  await closed;
});

// Host-access build so the folded grant is already satisfied: the primary reads
// plain "Create rule"/"Save changes" and commits from the keyboard without the
// native permission prompt. The keyboard create-and-edit coverage is unchanged.
test("options rules can be created and edited from the keyboard", {
  tag: "@host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  await seedState(serviceWorker, createV1Seed());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#rules`);

  const newRule = page.getByRole("button", {
    name: copy.options.allRules.newRule,
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
  const domainsScope = createDialog.getByRole("radio", {
    name: copy.editor.scopeType.domains,
  });
  const allSitesScope = createDialog.getByRole("radio", {
    name: copy.editor.allSites,
  });
  await expect(domainsScope).toBeChecked();
  await allSitesScope.focus();
  await expect(allSitesScope).toBeFocused();
  await page.keyboard.press("Space");
  await expect(allSitesScope).toBeChecked();
  await expect(domainsScope).not.toBeChecked();

  const create = createDialog.getByRole("button", {
    name: copy.actions.createRule,
    exact: true,
  });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(createDialog).toBeHidden();

  await expect.poll(() => firstRuleValue(serviceWorker)).toBe("created");
  // All-sites access is statically granted in this build, so the saved rule is
  // able to run rather than blocked.
  const row = page.locator(".fleet-row").first();
  await expect(row).toHaveClass(/\blive\b/);
  await row.locator(".fleet-open").focus();
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
    exact: true,
  });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(editDialog).toBeHidden();
  await expect.poll(() => firstRuleValue(serviceWorker)).toBe("edited");
});
