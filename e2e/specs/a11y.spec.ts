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
  // them so every surface is measured in its resting state.
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
    }),
    rules: [first],
  };
  const local = {
    ...createProfile({
      name: "Local",
      badgeText: "LO",
      color: "teal",
    }),
    rules: [second],
  };
  return {
    ...doc,
    profiles: [primary, local],
    activeProfileId: primary.id,
    settings: { ...doc.settings, ...over },
  };
}

// A page that never links the token stylesheet collapses to unstyled default
// HTML: every var() resolves to nothing and the surface paints black-on-white,
// which still clears axe's contrast bar — so axe alone can't see a dropped
// stylesheet. Assert the tokens actually resolve on :root for every extension
// surface, so a missing import on any entrypoint fails deterministically here.
const SURFACES = ["popup.html", "options.html"];

test("design tokens load on every extension surface", async ({
  context,
  extensionId,
}) => {
  for (const surface of SURFACES) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${surface}`);

    const panel0 = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--paper")
        .trim(),
    );
    expect(panel0, `${surface}: --paper must resolve on :root`).not.toBe("");

    // The token has to actually paint, not just be declared: an unstyled body
    // reads back the transparent default rather than the panel fill.
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(background, `${surface}: body must paint --paper`).not.toBe(
      "rgba(0, 0, 0, 0)",
    );

    await page.close();
  }
});

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

    // A populated document with ungranted rules shows the needs-access
    // summary over the actionable blocked rows.
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
  }
});

test("every options page passes axe in both themes", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const sections = [
    "profiles",
    "site-access",
    "import-export",
    "settings",
    "about",
  ];

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
