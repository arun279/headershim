import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  createProfile,
  createRule,
  type RuleDraft,
  type StateDoc,
} from "../../src/core/model";
import { createV1Seed } from "../../src/core/schema";
import { copy } from "../../src/ui/copy";
import { expect, seedState, test } from "../fixtures";

const ALL_WARNINGS_FIXTURE = fileURLToPath(
  new URL("../fixtures/modheader-all-warnings.json", import.meta.url),
);

// WCAG 2.2 AA, both themes: every popup state and every options page reports
// zero axe violations. Contrast is measured against the real token stylesheet
// with the theme stamped by the app itself, so a token that fails in one theme
// is caught here rather than by eye.
const THEMES = ["light", "dark"] as const;

// The AA slice axe can decide statically: names/roles, contrast, and ARIA
// correctness. Logical focus order and keyboard operability are proven
// separately by keyboard.spec; subjective criteria stay on the manual pass.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function analyze(
  page: Page,
  surface: string,
  theme: (typeof THEMES)[number],
): Promise<void> {
  // The app stamps the seeded theme onto <html>; asserting it here means each
  // theme is genuinely measured against its own palette, not the same default.
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  // Transitions (editor expand, panel slide) blend colours mid-animation and
  // would let axe read a contrast that never settles; reduced motion removes
  // them (DESIGN §1.4) so every surface is measured in its resting state.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { violations } = await new AxeBuilder({ page })
    .withTags(TAGS)
    .analyze();
  expect(
    violations,
    `${surface}: ${violations
      .map((violation) => `${violation.id} (${violation.nodes.length})`)
      .join(", ")}`,
  ).toEqual([]);
}

function withTheme(doc: StateDoc, theme: (typeof THEMES)[number]): StateDoc {
  return { ...doc, settings: { ...doc.settings, theme } };
}

function ruleDoc(over: Partial<StateDoc["settings"]> = {}): StateDoc {
  let doc = createV1Seed();
  const build = (draft: RuleDraft) => {
    const [rule, next] = createRule(doc, draft);
    doc = next;
    return rule;
  };
  const first = build({
    direction: "request",
    operation: "set",
    header: "x-env",
    value: "staging",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: ["xhr"],
    initiators: [],
    enabled: true,
  });
  const second = build({
    direction: "response",
    operation: "remove",
    header: "server",
    scope: { type: "domains", domains: ["api.example.com"] },
    resourceTypes: ["xhr"],
    initiators: [],
    enabled: true,
  });
  const primary = {
    ...createProfile({
      name: "Default",
      badgeText: "DE",
      color: "indigo",
      enabled: true,
    }),
    rules: [first],
  };
  const local = {
    ...createProfile({
      name: "Local",
      badgeText: "LO",
      color: "teal",
      enabled: true,
    }),
    rules: [second],
  };
  return {
    ...doc,
    profiles: [primary, local],
    focusedProfileId: primary.id,
    settings: { ...doc.settings, ...over },
  };
}

test("every popup state passes axe in both themes", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const url = `chrome-extension://${extensionId}/popup.html`;
  const open = async (doc: StateDoc, theme: (typeof THEMES)[number]) => {
    await seedState(serviceWorker, withTheme(doc, theme));
    const page = await context.newPage();
    await page.goto(url);
    return page;
  };

  for (const theme of THEMES) {
    // Storage-driven states share one page: a fresh seed re-renders it in place.
    const base = await open(createV1Seed(), theme);
    await expect(base.locator(".first-run")).toBeVisible();
    await analyze(base, `popup first-run (${theme})`, theme);

    // A populated document with ungranted rules lights the needs-access
    // annunciator over a full rule list — the loud state and the rows at once.
    await seedState(serviceWorker, withTheme(ruleDoc(), theme));
    await expect(
      base.locator('.annunciator[data-state="needs-access"]'),
    ).toBeVisible();
    await expect(base.locator(".rule-row").first()).toBeVisible();
    await analyze(base, `popup needs-access + rules (${theme})`, theme);

    await seedState(serviceWorker, withTheme(ruleDoc({ paused: true }), theme));
    await expect(
      base.locator('.annunciator[data-state="paused"]'),
    ).toBeVisible();
    await analyze(base, `popup paused (${theme})`, theme);
    await base.close();

    // Each interactive layer opens on its own page: Esc would reach the
    // popup-close command and shut the window out from under a later state.
    const editor = await open(ruleDoc(), theme);
    await editor
      .getByRole("button", { name: copy.actions.newRule })
      .first()
      .click();
    await expect(editor.locator(".rule-editor")).toBeVisible();
    await analyze(editor, `popup rule editor (${theme})`, theme);
    await editor.close();

    // The grant panel: committing an ungranted rule with Enter opens it without
    // firing the (unscriptable) permission prompt.
    const grant = await open(ruleDoc(), theme);
    await grant.locator(".rule-row").first().focus();
    await grant.keyboard.press("Enter");
    await expect(grant.locator(".rule-editor")).toBeVisible();
    await grant.locator(".rule-editor .value-row input").focus();
    await grant.keyboard.press("Enter");
    await expect(grant.locator(".grant-panel")).toBeVisible();
    await analyze(grant, `popup grant panel (${theme})`, theme);
    await grant.close();

    const thisTab = await open(ruleDoc(), theme);
    await thisTab.locator(".profiles .chip").first().focus();
    await thisTab.keyboard.press("t");
    await expect(thisTab.locator(".this-tab")).toBeVisible();
    await analyze(thisTab, `popup this-tab composer (${theme})`, theme);
    await thisTab.close();

    const verify = await open(ruleDoc(), theme);
    await verify.getByRole("button", { name: copy.actions.verify }).click();
    await expect(verify.locator(".verify")).toBeVisible();
    await analyze(verify, `popup verify panel (${theme})`, theme);
    await verify.close();
  }
});

test("every options page passes axe in both themes", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const sections = ["profiles", "import-export", "site-access", "about"];

  for (const theme of THEMES) {
    const page = await context.newPage();
    await seedState(serviceWorker, withTheme(ruleDoc(), theme));
    await page.goto(`chrome-extension://${extensionId}/options.html#profiles`);

    for (const section of sections) {
      await page.goto(
        `chrome-extension://${extensionId}/options.html#${section}`,
      );
      await expect(page.locator(".page-title")).toBeVisible();
      await analyze(page, `options ${section} (${theme})`, theme);
    }

    // The pre-apply import summary with its itemized warnings — a distinct
    // options surface reached by picking a file.
    await page.goto(
      `chrome-extension://${extensionId}/options.html#import-export`,
    );
    await page
      .locator('input[type="file"]')
      .setInputFiles(ALL_WARNINGS_FIXTURE);
    await expect(page.locator(".import-summary")).toBeVisible();
    await analyze(page, `options import summary (${theme})`, theme);

    await page.close();
  }
});
