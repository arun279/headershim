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

// SPEC §4.5, the popup half: every in-popup binding driven through real key
// events against the built popup. The global commands (Alt+Shift+…) are the
// browser's own shortcut manager dispatching chrome.commands and cannot be
// synthesized by Playwright or CDP; they are recorded as a checklist item at
// the end of this file.

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
const rows = (page: Page) => page.locator(".rule-row");

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
  await expect(page.locator(".verify")).toBeVisible();

  // p toggles global pause: the annunciator flips to the paused tier.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("p");
  await expect(page.locator('.annunciator[data-state="paused"]')).toBeVisible();

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
  await expect(chips(page).nth(1)).toHaveAttribute("aria-current", "true");
  await expect(chips(page).nth(1)).not.toHaveClass(/\boff\b/);
  await expect(chips(page).first()).toHaveClass(/\boff\b/);

  // Shift+2 toggles the second on without turning the first off.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await chips(page).first().focus();
  await page.keyboard.press("Shift+Digit2");
  await expect(chips(page).nth(1)).not.toHaveClass(/\boff\b/);
  await expect(chips(page).first()).not.toHaveClass(/\boff\b/);

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
  await expect(rows(page).first()).toHaveClass(/\bdisabled\b/);

  // Delete removes the focused row (2 → 1) and offers undo.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await expect(rows(page)).toHaveCount(2);
  await rows(page).first().focus();
  await page.keyboard.press("Delete");
  await expect(rows(page)).toHaveCount(1);
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible();
  await expect(
    toast.getByRole("button", { name: copy.actions.undo }),
  ).toBeVisible();

  await page.close();
});

test("editor commit keys commit, grant, and close", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();

  // Enter commits an edit and closes the editor. The rule is all-sites scoped,
  // so committing routes through no popup grant prompt and just closes; the
  // edited value landing in storage proves Enter committed rather than
  // discarded.
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
  await page
    .locator(".rule-editor .value-row input")
    .fill("committed-on-enter");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeHidden();
  expect(await firstRuleValue(serviceWorker)).toBe("committed-on-enter");

  // Ctrl/Cmd+Enter commits and opens the grant flow in the same gesture: the
  // edit lands in storage (commit) and the ungranted rule surfaces the grant
  // panel. The prompt it then fires is the same unscriptable
  // permissions.request boundary the harness records elsewhere.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  await page.locator(".rule-editor .value-row input").fill("committed-on-cmd");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".grant-panel")).toBeVisible();
  expect(await firstRuleValue(serviceWorker)).toBe("committed-on-cmd");

  // Esc closes the open editor; a second Esc with no layer closes the popup.
  await openPopup(page, extensionId, serviceWorker, baseDoc());
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rule-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".rule-editor")).toBeHidden();
  await rows(page).first().focus();
  const closed = page.waitForEvent("close");
  // The keypress runs window.close() synchronously, which can tear the page
  // down before press() resolves; the close event is the assertion.
  await page.keyboard.press("Escape").catch(() => {});
  await closed;
});

// SPEC §4.5 global commands are dispatched by the browser's shortcut manager
// into chrome.commands; neither Playwright nor CDP can synthesize that input,
// so Alt+Shift+H/P/V/K stay on the per-release manual keyboard pass. The
// popup-side behaviour each one triggers (open popup, pause, verify, switch
// profile) is covered above through its in-popup equivalent.
test.skip("global Alt+Shift shortcuts are a manual checklist item", () => {});
