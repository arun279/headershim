import type { Locator, Page, Worker } from "@playwright/test";
import type { StateDoc } from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import { copy } from "../../src/ui/copy";
import {
  expect,
  seedState,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

// The popup's real in-popup key bindings, driven through key events against the
// built popup: the popup-wide `n` command and the editor's own key semantics
// (plain Enter never saves, Ctrl/Cmd+Enter is the save chord, Esc reverts or
// guards a dirty draft, and a bare Esc closes the popup). The global commands
// (Alt+Shift+…) are the browser's own shortcut manager dispatching
// chrome.commands and cannot be synthesized by Playwright or CDP; their
// application-side command handlers run in src/test/background.test.ts.

async function openPopup(
  page: Page,
  extensionId: string,
  serviceWorker: Worker,
  doc: StateDoc,
): Promise<void> {
  await seedState(serviceWorker, doc);
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // The profile switcher is the head landmark the Ready view always draws, so
  // its presence is the stable signal that the popup has rendered.
  await expect(
    page.getByRole("button", { name: copy.readout.switcher.chipLabel }),
  ).toBeVisible();
}

// The popup's keydown listener attaches in a post-paint effect, so a shortcut
// pressed the instant the head lands can fall in the gap before it is live and
// be dropped. Re-press until the layer it opens is on screen. Each attempt first
// checks whether the layer is already up, so a press that landed just after the
// inner timeout is never followed by a stray keypress into the layer's focused
// field; the whole retry stays inside the configured expect timeout.
async function pressUntilVisible(
  page: Page,
  key: string,
  layer: Locator,
): Promise<void> {
  await expect(async () => {
    if (await layer.isVisible()) return;
    await page.keyboard.press(key);
    await expect(layer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

function firstRuleValue(serviceWorker: Worker): Promise<string | undefined> {
  return serviceWorker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    return (state as StateDoc | undefined)?.profiles[0]?.rules[0]?.value;
  });
}

function firstRuleEnabled(serviceWorker: Worker): Promise<boolean | undefined> {
  return serviceWorker.evaluate(async () => {
    const { state } = await chrome.storage.local.get("state");
    return (state as StateDoc | undefined)?.profiles[0]?.rules[0]?.enabled;
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
  await openPopup(page, extensionId, serviceWorker, createV1Seed());
  await pressUntilVisible(
    page,
    "n",
    page.getByRole("dialog", { name: copy.editor.heading("new", "Default") }),
  );
});

// The `t` command opens the This-tab composer. The redesigned composer authors
// against the tab's own host, so unlike the deleted no-host version it needs a
// resolved host: it runs on the host-access build with a real web tab in front,
// and the footer's Just-this-tab control appearing is the signal the host has
// resolved and the popup's keydown listener is live.
test("the this-tab shortcut opens the composer", {
  tag: "@host-access",
}, async ({ context, echoServers, extensionId, serviceWorker }) => {
  await seedState(serviceWorker, createV1Seed());
  const web = await context.newPage();
  await web.goto(`${echoServers.h1Url}/compose`);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await web.bringToFront();
  await page.reload();

  await expect(
    page.getByRole("button", { name: copy.readout.justThisTab }),
  ).toBeVisible();
  await pressUntilVisible(
    page,
    "t",
    page.getByRole("region", { name: copy.readout.newChange }),
  );
});

// The editor key semantics run on the static host-access build so the seeded
// all-sites scope commits with no native permission prompt, and each opens its
// own freshly seeded popup so nothing races a re-seed of a reused page. The
// editor is reached through the popup's own `n` command: the popup authors a
// new rule and no longer opens a full editor over an existing readout line.

// Plain Enter belongs to the field and never saves or closes the editor, from
// the value textarea or from another field; the chord is the keyboard save path.
test("plain Enter stays in a field while the commit chord saves", {
  tag: "@host-access",
}, async ({ context, extensionId, serviceWorker }) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, createV1Seed());
  const editor = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await pressUntilVisible(page, "n", editor);

  await editor
    .getByRole("combobox", { name: copy.editor.labels.headerName })
    .fill("x-commit-chord");
  const value = editor.getByRole("textbox", { name: copy.editor.labels.value });
  await expect(value).toHaveJSProperty("tagName", "TEXTAREA");
  await expect(value).toHaveClass(/\bvalue-input\b/);
  await value.fill("not-yet-committed");
  // The radio input is .sr-only, so the pointer click lands on the visible
  // enclosing label; the checked state is still read back by role.
  await editor
    .locator("label.segmented-option", { hasText: copy.editor.allSites })
    .click();
  await expect(
    editor.getByRole("radio", { name: copy.editor.allSites }),
  ).toBeChecked();

  // Plain Enter from the value textarea neither saves nor mangles the field.
  await value.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await expect(value).toHaveValue("not-yet-committed");
  expect(await firstRuleValue(serviceWorker)).toBeUndefined();

  // Plain Enter from another field is just as inert.
  await editor
    .getByRole("combobox", { name: copy.editor.labels.headerName })
    .focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  expect(await firstRuleValue(serviceWorker)).toBeUndefined();

  // The chord is the one keyboard save path.
  await value.focus();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editor).toBeHidden();
  await expect
    .poll(() => firstRuleValue(serviceWorker))
    .toBe("not-yet-committed");
});

// Esc on an untouched draft closes directly and commits nothing.
test("Esc on a clean draft closes without committing", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, createV1Seed());
  const editor = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await pressUntilVisible(page, "n", editor);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  expect(await firstRuleValue(serviceWorker)).toBeUndefined();
});

// Esc on a dirty draft asks before discarding. A second Esc keeps editing;
// choosing Discard closes the editor committing nothing, and only then can Esc
// close the popup.
test("Esc on a dirty draft guards, then a bare Esc closes the popup", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, createV1Seed());
  const editor = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await pressUntilVisible(page, "n", editor);
  await editor
    .getByRole("textbox", { name: copy.editor.labels.value })
    .fill("dirty-draft");
  await page.keyboard.press("Escape");
  await expect(
    editor.getByText(copy.editor.discardConfirm.title, { exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", {
      name: copy.editor.discardConfirm.keepEditing,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    editor.getByText(copy.editor.discardConfirm.title, { exact: true }),
  ).toBeHidden();

  await page.keyboard.press("Escape");
  const discard = editor.getByRole("button", {
    name: copy.editor.discardConfirm.discard,
    exact: true,
  });
  await discard.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeHidden();
  expect(await firstRuleValue(serviceWorker)).toBeUndefined();

  const closed = page.waitForEvent("close");
  // With no layer open the bare Esc runs window.close() synchronously, which can
  // tear the page down before press() resolves; the close event is the assertion.
  await page.keyboard.press("Escape").catch(() => {});
  await closed;
});

// The redesigned readout draws each rule's on/off as a native role="switch"
// button that sits in the tab order. Keyboard activation of it is what the
// deleted roving-focus Space-toggle test guarded, so it is proven here end to
// end: focus the switch, press Space, and the stored rule flips. Runs on the
// host-access build so the popup can read the tab host and render the row.
test("the readout switch flips its rule from the keyboard", {
  tag: "@host-access",
}, async ({ context, echoServers, extensionId, serviceWorker }) => {
  const host = new URL(echoServers.h1Url).hostname;
  await seedStateAndWait(
    serviceWorker,
    stateWithRules([
      {
        direction: "request",
        operation: "set",
        header: "x-keyboard-toggle",
        value: "on",
        scope: { type: "domains", domains: [host] },
        resourceTypes: ["xhr"],
        initiators: [],
        enabled: true,
      },
    ]),
  );

  // A web tab at the echo host, brought to front before the popup re-mounts,
  // gives the popup a real host to project the rule onto.
  const web = await context.newPage();
  await web.goto(`${echoServers.h1Url}/toggle`);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await web.bringToFront();
  await page.reload();

  const on = page.getByRole("switch", {
    name: copy.readout.ruleToggle("x-keyboard-toggle", true),
  });
  await expect(on).toBeChecked();

  await on.focus();
  await page.keyboard.press("Space");

  await expect.poll(() => firstRuleEnabled(serviceWorker)).toBe(false);
  await expect(
    page.getByRole("switch", {
      name: copy.readout.ruleToggle("x-keyboard-toggle", false),
    }),
  ).not.toBeChecked();
});

// The options Rules page keeps a keyboard-openable New rule button and
// keyboard-editable rules through the shared editor; the popup no longer authors
// over an existing line, so this full create-then-edit round trip is proven
// here. Host-access build so the folded grant is already satisfied: the primary
// reads plain "Create rule"/"Save changes" and commits from the keyboard with
// no native permission prompt.
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
  // A radio is keyboard-operable even while .sr-only, so focus lands on it and
  // Space selects it; only a pointer click needs the visible label.
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
