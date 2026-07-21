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
import {
  expect,
  seedState,
  seedStateAndWait,
  stateWithRules,
  test,
} from "../fixtures";

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

// Rules scoped to the tab in front of the popup: one Request line and one
// Response line. Rendered on the host-access build, where the tab URL is
// readable and *://*/* is granted, both read live — enough to measure the
// populated readout's change-line grammar, its contrast, and the picker ARIA
// the redesign landed. (The ungranted-but-readable needs-access state is not
// reproducible on any e2e build; readout.test.ts and the grant-flow
// integration test cover its DOM.)
function populatedDoc(host: string): StateDoc {
  return stateWithRules([
    {
      direction: "request",
      operation: "set",
      header: "x-env",
      value: "staging",
      scope: { type: "domains", domains: [host] },
      resourceTypes: ["xhr"],
      initiators: [],
      enabled: true,
    },
    {
      direction: "response",
      operation: "set",
      header: "x-trace",
      value: "on",
      scope: { type: "domains", domains: [host] },
      resourceTypes: ["xhr"],
      initiators: [],
      enabled: true,
    },
  ]);
}

function pausedPopulatedDoc(host: string): StateDoc {
  const doc = populatedDoc(host);
  return { ...doc, settings: { ...doc.settings, paused: true } };
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

// The no-host states render on the shipped build: a popup opened on its own
// store page reads no web host (activeTab is never granted by a goto), so the
// readout is hostless. That is exactly the honest-empty and paused-banner
// surfaces, and the only popup states the shipped build can paint.
test("every no-host popup state passes axe in both themes", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const url = `chrome-extension://${extensionId}/popup.html`;

  for (const theme of THEMES) {
    // First run, opened with no site in front: the one honest empty line.
    await seedState(serviceWorker, withTheme(createV1Seed(), theme));
    const firstRun = await context.newPage();
    // Front the popup before it mounts so its active-tab read is itself (a
    // store page, no host).
    await firstRun.bringToFront();
    await firstRun.goto(url);
    await expect(firstRun.getByText(copy.readout.noHost)).toBeVisible();
    await analyze(firstRun, `popup first run (${theme})`, theme);
    await firstRun.close();

    // Paused with no site in front: the one banner over the resting page.
    await seedState(serviceWorker, withTheme(ruleDoc({ paused: true }), theme));
    const paused = await context.newPage();
    await paused.bringToFront();
    await paused.goto(url);
    await expect(
      paused.getByRole("status").filter({ hasText: copy.readout.pausedBanner }),
    ).toBeVisible();
    await analyze(paused, `popup paused no-host (${theme})`, theme);
    await paused.close();
  }
});

// The populated readout, the rule editor's Add path, the This-tab composer, and
// a populated paused readout only exist when the popup reads a real host, so
// their axe coverage runs on the static host-access build: a web tab at the
// echo host, brought to front before the popup re-mounts, gives the popup one.
// That build grants *://*/*, so every reaching rule reads live rather than
// needs-access — the readout's change-line grammar, contrast, and ARIA in both
// themes are what this measures, not the ungranted state (which no e2e build
// can paint and the readout/grant-flow tests cover instead).
test("every populated popup state passes axe in both themes", {
  tag: "@host-access",
}, async ({ context, echoServers, extensionId, serviceWorker }) => {
  const url = `chrome-extension://${extensionId}/popup.html`;
  const host = new URL(echoServers.h1Url).hostname;

  const web = await context.newPage();
  await web.goto(`${echoServers.h1Url}/a11y`);

  const openOnHost = async (doc: StateDoc, theme: (typeof THEMES)[number]) => {
    await seedStateAndWait(serviceWorker, withTheme(doc, theme));
    const page = await context.newPage();
    await page.goto(url);
    // newPage steals focus to the popup, so its first mount reads no host;
    // fronting the web tab and reloading re-mounts it over the echo host.
    await web.bringToFront();
    await page.reload();
    return page;
  };

  for (const theme of THEMES) {
    // Populated over the granted host: a Request line and a Response line, both
    // live. Asserting both direction regions proves each group rendered before
    // axe measures the change-line grammar.
    const populated = await openOnHost(populatedDoc(host), theme);
    await expect(
      populated.getByRole("region", { name: copy.readout.direction.request }),
    ).toBeVisible();
    await expect(
      populated.getByRole("region", { name: copy.readout.direction.response }),
    ).toBeVisible();
    await analyze(populated, `popup populated (${theme})`, theme);

    // The rule editor layer, opened from the populated readout's Add action.
    await populated
      .getByRole("button", { name: copy.readout.addChange })
      .first()
      .click();
    await expect(
      populated.getByRole("dialog", {
        name: copy.editor.heading("new", "Default"),
      }),
    ).toBeVisible();
    await analyze(populated, `popup rule editor (${theme})`, theme);
    await populated.close();

    // The This-tab composer layer, reached from the same host readout.
    const composer = await openOnHost(populatedDoc(host), theme);
    await composer
      .getByRole("button", { name: copy.readout.justThisTab })
      .click();
    await expect(
      composer.getByRole("region", { name: copy.readout.newChange }),
    ).toBeVisible();
    await analyze(composer, `popup this-tab composer (${theme})`, theme);
    await composer.close();

    // A populated paused readout: every reaching line drawn at rest under the
    // banner, so the paused change-line grammar is measured, not only the
    // no-host banner from the shipped-build test.
    const paused = await openOnHost(pausedPopulatedDoc(host), theme);
    await expect(
      paused.getByRole("status").filter({ hasText: copy.readout.pausedBanner }),
    ).toBeVisible();
    await expect(
      paused.getByRole("region", { name: copy.readout.direction.request }),
    ).toBeVisible();
    await analyze(paused, `popup populated paused (${theme})`, theme);
    await paused.close();
  }

  await web.close();
});

test("every options page passes axe in both themes", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // Each route's own level-1 title, so a routing bug that renders the wrong
  // page's <h1> under the right hash fails here rather than passing on the mere
  // presence of some heading.
  const sections = [
    { hash: "rules", title: copy.options.allRules.title },
    { hash: "profiles", title: copy.options.profiles.title },
    { hash: "site-access", title: copy.options.siteAccess.title },
    { hash: "traffic", title: copy.options.traffic.title },
    { hash: "import-export", title: copy.options.importExport.title },
    { hash: "settings", title: copy.options.settings.title },
    { hash: "about", title: copy.options.about.title },
  ];

  for (const theme of THEMES) {
    const page = await context.newPage();
    await seedState(serviceWorker, withTheme(ruleDoc(), theme));
    await page.goto(`chrome-extension://${extensionId}/options.html#rules`);

    for (const { hash, title } of sections) {
      await page.goto(`chrome-extension://${extensionId}/options.html#${hash}`);
      // The routed level-1 title the redesign renders as <h1 class="wb-title">.
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      await analyze(page, `options ${hash} (${theme})`, theme);
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
