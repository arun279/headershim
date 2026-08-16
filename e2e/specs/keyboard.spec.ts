import type { Worker } from "@playwright/test";
import { COMMON_HEADER_NAMES } from "../../src/core/header-names";
import type { StateDoc } from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import { copy } from "../../src/ui/copy";
import {
  expect,
  openPopup,
  seedState,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";
import { pathologicalDoc } from "../fixtures/pathological";

// The popup's real in-popup key bindings, driven through key events against the
// built popup: the popup-wide `n` command and the editor's own key semantics
// (plain Enter never saves, Ctrl/Cmd+Enter is the save chord, Esc reverts or
// guards a dirty draft, and a bare Esc closes the popup). The global commands
// (Alt+Shift+…) are the browser's own shortcut manager dispatching
// chrome.commands and cannot be synthesized by Playwright or CDP; their
// application-side command handlers run in src/test/background.test.ts.

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
  await page.keyboard.press("n");
  await expect(
    page.getByRole("dialog", { name: copy.editor.heading("new", "Default") }),
  ).toBeVisible();
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
  await page.keyboard.press("t");
  await expect(
    page.getByRole("region", { name: copy.readout.newChange }),
  ).toBeVisible();
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
  await page.keyboard.press("n");
  await expect(editor).toBeVisible();

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

// Typing into the header-name field opens its suggestion list with no chevron
// click and no arrow key; Esc then closes that list first, leaving the typed
// text and the editor itself untouched, before a second Esc would reach the
// editor's own guard.
test("typing opens the header suggestion list, and Esc closes only that", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await openPopup(page, extensionId, serviceWorker, createV1Seed());
  const editor = page.getByRole("dialog", {
    name: copy.editor.heading("new", "Default"),
  });
  await page.keyboard.press("n");
  await expect(editor).toBeVisible();

  const name = editor.getByRole("combobox", {
    name: copy.editor.labels.headerName,
  });
  const expectedName = COMMON_HEADER_NAMES.find((entry) =>
    entry.startsWith("auth"),
  );
  if (expectedName === undefined) {
    throw new Error('no bundled header name starts with "auth"');
  }
  const prefix = expectedName.slice(0, 4);
  await name.pressSequentially(prefix);
  await expect(
    editor.getByRole("option", { name: new RegExp(`^${expectedName}`) }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(editor.getByRole("listbox")).toBeHidden();
  await expect(name).toHaveValue(prefix);
  await expect(editor).toBeVisible();
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
  await page.keyboard.press("n");
  await expect(editor).toBeVisible();
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
  await page.keyboard.press("n");
  await expect(editor).toBeVisible();
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
    name: copy.rules.switchLabel("x-keyboard-toggle", true),
  });
  await expect(on).toBeChecked();

  await on.focus();
  await page.keyboard.press("Space");

  await expect.poll(() => firstRuleEnabled(serviceWorker)).toBe(false);
  await expect(
    page.getByRole("switch", {
      name: copy.rules.switchLabel("x-keyboard-toggle", false),
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

// Opening the rule editor and closing it, and switching profiles, must each
// leave focus on a real element, never stranded on <body>, which would drop
// keyboard and screen-reader users with no anchor (WCAG 2.4.3). The platform
// only restores focus when it is inside a closing dialog, so app code owns this.
// Driven under the pathological seed so a long value or profile name cannot
// knock focus loose, and polled because focus settles a frame after a layer
// unmounts. Host-access build with a web tab in front so the readout resolves a
// host and both the editor and the switch are reachable.
test("popup layer transitions never strand focus on the body", {
  tag: "@host-access",
}, async ({ context, echoServers, extensionId, serviceWorker }) => {
  const host = new URL(echoServers.h1Url).hostname;
  await seedStateAndWait(serviceWorker, pathologicalDoc(host));
  const web = await context.newPage();
  await web.goto(`${echoServers.h1Url}/focus`);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await web.bringToFront();
  await page.reload();

  const focusOnBody = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return active === null || active === document.body;
    });

  // The rule editor is opened from the Add control and closed with Escape: focus
  // enters the dialog, and on close it returns to the readout landmark rather
  // than falling to the body (the editor is a full-surface swap that unmounts the
  // opener, so the app, not the platform, has to place focus).
  await page
    .getByRole("button", { name: copy.readout.addChange })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await expect.poll(focusOnBody).toBe(false);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect.poll(focusOnBody).toBe(false);

  // Switching profiles from the picker lands focus on the switch trigger. Pick
  // the first unselected row: a profile name can truncate in the picker, so it
  // cannot be selected reliably by a name that may be cut.
  await page
    .getByRole("button", { name: copy.readout.switcher.chipLabel })
    .click();
  const picker = page.locator("#profile-switch-pop");
  await expect(picker).toBeVisible();
  await picker.locator(".pop-list .popt:not(.sel)").first().click();
  await expect(picker).toBeHidden();
  await expect.poll(focusOnBody).toBe(false);
});
