// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../entrypoints/options/App";
import { ALL_SITES_ORIGIN } from "../core/grants";
import type { Profile, Rule } from "../core/model";
import { originPatternForDomain } from "../core/scope";
import { write } from "../platform/store";
import { copy } from "../ui/copy";
import { profile, resetFixtures, rule, stateDoc } from "../ui/test/fixtures";
import { findButton, fire, render, settle } from "../ui/test/render";

const text = copy.options.siteAccess;

async function mount(profiles: Profile[]): Promise<HTMLElement> {
  await write(stateDoc(profiles));
  window.location.hash = "#site-access";
  const root = render(<App />);
  await settle();
  return root;
}

/** One profile whose single rule wants api.example.com and nothing else. */
function apiRuleOnly(): Profile[] {
  return [
    profile("p1", {
      rules: [
        rule({ scope: { type: "domains", domains: ["api.example.com"] } }),
      ],
    }),
  ];
}

function grantOrigins(...domains: string[]): Promise<boolean> {
  return fakeBrowser.permissions.request({
    origins: domains.map(originPatternForDomain),
  });
}

function group(root: HTMLElement, heading: string): HTMLElement {
  const list = root.querySelector<HTMLElement>(`ul[aria-label="${heading}"]`);
  if (list === null) {
    throw new Error(`no group "${heading}"`);
  }
  return list;
}

function rowButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (button === null) {
    throw new Error(`no button "${label}"`);
  }
  return button;
}

/** Asserts the loud group is gone and `domain` now sits under Granted. */
function expectGranted(root: HTMLElement, domain: string): void {
  expect(root.querySelector(`ul[aria-label="${text.neededHeading}"]`)).toBe(
    null,
  );
  expect(group(root, text.grantedHeading).textContent).toContain(domain);
}

function expectAllSitesCollapsed(root: HTMLElement): void {
  expect(root.textContent).toContain(text.allSites.consequence);
  expect(root.textContent).not.toContain(text.allSites.warning);
  expect(() => findButton(root, text.allSites.button)).toThrow();
}

function openAllSitesReview(root: HTMLElement): void {
  const disclosure = root.querySelector<HTMLButtonElement>(".sa-disclosure");
  if (disclosure === null) throw new Error("no all-sites disclosure");
  fire(() => disclosure.click());
}

/** The sensitive-rule caution text shown under an open all-sites review, if any. */
async function allSitesCaution(rules: Rule[]): Promise<string | null> {
  const root = await mount([profile("p1", { rules })]);
  openAllSitesReview(root);
  return root.querySelector(".sa-all-caution")?.textContent ?? null;
}

describe("options site access", () => {
  beforeEach(() => {
    resetFixtures();
  });

  it("lists needed origins first, then granted, and moves rows on grant", async () => {
    await grantOrigins("granted.example.com");
    const root = await mount([
      profile("p1", {
        rules: [
          rule({ scope: { type: "domains", domains: ["api.example.com"] } }),
          rule({ scope: { type: "domains", domains: ["api.example.com"] } }),
          rule({
            scope: { type: "domains", domains: ["granted.example.com"] },
          }),
        ],
      }),
    ]);

    const needed = group(root, text.neededHeading);
    expect(needed.textContent).toContain("api.example.com");
    expect(needed.textContent).toContain(text.usedBy(2));
    expect(group(root, text.grantedHeading).textContent).toContain(
      "granted.example.com",
    );
    // The actionable group renders above the granted one.
    expect(
      needed.compareDocumentPosition(group(root, text.grantedHeading)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fire(() => rowButton(root, text.grantLabel("api.example.com")).click());
    await settle();

    expectGranted(root, "api.example.com");
    // The clicked row reparented to the granted group, unmounting its button;
    // focus lands on the page heading, never <body> (WCAG 2.4.3).
    expect(document.activeElement?.id).toBe("site-access-title");
  });

  it("lists a pattern rule's persisted hosts among needed origins", async () => {
    const root = await mount([
      profile("p1", {
        rules: [
          rule({
            scope: {
              type: "pattern",
              pattern: "||api.example.com^",
              hosts: ["api.example.com"],
            },
          }),
        ],
      }),
    ]);

    expect(group(root, text.neededHeading).textContent).toContain(
      "api.example.com",
    );
  });

  it("revokes in one click and returns a still-needed origin to the loud group", async () => {
    await grantOrigins("api.example.com");
    const root = await mount(apiRuleOnly());

    fire(() => rowButton(root, text.revokeLabel("api.example.com")).click());
    await settle();

    expect(group(root, text.neededHeading).textContent).toContain(
      "api.example.com",
    );
    expect(root.querySelector(`ul[aria-label="${text.grantedHeading}"]`)).toBe(
      null,
    );
  });

  it("reflects a grant made outside the page without a reload", async () => {
    const root = await mount(apiRuleOnly());

    expect(group(root, text.neededHeading).textContent).toContain(
      "api.example.com",
    );

    await grantOrigins("api.example.com");
    await settle();

    expectGranted(root, "api.example.com");
  });

  it("shows the honest all-sites card and swaps it for the revoke line after grant", async () => {
    const root = await mount([profile("p1")]);

    expectAllSitesCollapsed(root);
    expect(root.textContent).not.toContain(text.allSites.on);

    const disclosure = root.querySelector<HTMLButtonElement>(".sa-disclosure");
    if (disclosure === null) throw new Error("no all-sites disclosure");
    expect(disclosure.textContent).toContain(text.allSites.disclosure);
    expect(disclosure.getAttribute("aria-controls")).toBe(null);
    fire(() => disclosure.click());
    expect(disclosure.getAttribute("aria-controls")).toBe("all-sites-details");
    const details = root.querySelector<HTMLElement>(".sa-all-details");
    if (details === null) throw new Error("no expanded all-sites details");
    expect(details.textContent).toContain(text.allSites.warning);
    const warning = details.querySelector(".sa-all-warning");
    if (warning === null) throw new Error("no all-sites warning");
    const allow = findButton(details, text.allSites.button);
    expect(
      warning.compareDocumentPosition(allow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fire(() => allow.click());
    await settle();

    expect(root.textContent).toContain(text.allSites.on);
    expect(root.textContent).not.toContain(text.allSites.warning);

    fire(() => findButton(root, text.revoke).click());
    await settle();

    expect(root.textContent).not.toContain(text.allSites.on);
    expectAllSitesCollapsed(root);
    expect(
      await fakeBrowser.permissions.contains({ origins: [ALL_SITES_ORIGIN] }),
    ).toBe(false);
  });

  it("cautions when an enabled sensitive rule is scoped to all sites", async () => {
    expect(
      await allSitesCaution([
        rule({
          operation: "set",
          header: "authorization",
          scope: { type: "all" },
        }),
      ]),
    ).toBe(text.allSites.sensitive(1));
  });

  it("cautions for a sensitive pattern rule with no grant hosts", async () => {
    expect(
      await allSitesCaution([
        rule({
          operation: "set",
          header: "authorization",
          scope: {
            type: "pattern",
            pattern: "||example.com^",
            hosts: [],
          },
        }),
      ]),
    ).toBe(text.allSites.sensitive(1));
  });

  it("does not caution for a sensitive pattern rule bounded by its grant hosts", async () => {
    expect(
      await allSitesCaution([
        rule({
          operation: "set",
          header: "authorization",
          scope: {
            type: "pattern",
            pattern: "||example.com^",
            hosts: ["example.com"],
          },
        }),
      ]),
    ).toBeNull();
  });

  it("cautions for a broad rule that changes a security response header", async () => {
    expect(
      await allSitesCaution([
        rule({
          direction: "response",
          operation: "set",
          header: "content-security-policy",
          value: "default-src 'none'",
          scope: { type: "all" },
        }),
      ]),
    ).toBe(text.allSites.sensitive(1));
  });

  it("counts every broad sensitive rule in the caution", async () => {
    expect(
      await allSitesCaution([
        rule({
          operation: "set",
          header: "authorization",
          scope: { type: "all" },
        }),
        rule({ operation: "set", header: "cookie", scope: { type: "all" } }),
      ]),
    ).toBe(text.allSites.sensitive(2));
  });

  it("does not caution for a broad rule that carries no credential or protection", async () => {
    expect(
      await allSitesCaution([
        rule({ operation: "set", header: "x-custom", scope: { type: "all" } }),
      ]),
    ).toBeNull();
  });

  it("does not caution for a narrowly scoped sensitive rule", async () => {
    expect(
      await allSitesCaution([
        rule({
          operation: "set",
          header: "authorization",
          scope: { type: "domains", domains: ["example.com"] },
        }),
      ]),
    ).toBeNull();
  });

  it("preserves individual grants when all-sites access is revoked", async () => {
    await fakeBrowser.permissions.request({ origins: [ALL_SITES_ORIGIN] });
    await grantOrigins("api.example.com");
    const root = await mount([
      profile("p1", {
        rules: [
          rule({ scope: { type: "domains", domains: ["api.example.com"] } }),
          rule({ scope: { type: "domains", domains: ["other.example.com"] } }),
        ],
      }),
    ]);

    const revokeAll =
      root.querySelector<HTMLButtonElement>(".sa-all-on button");
    if (revokeAll === null) throw new Error("no all-sites revoke button");
    fire(() => revokeAll.click());
    await settle();

    expect(
      await fakeBrowser.permissions.contains({ origins: [ALL_SITES_ORIGIN] }),
    ).toBe(false);
    expect(
      await fakeBrowser.permissions.contains({
        origins: [originPatternForDomain("api.example.com")],
      }),
    ).toBe(true);
    expect(group(root, text.grantedHeading).textContent).toContain(
      "api.example.com",
    );
    expect(group(root, text.neededHeading).textContent).toContain(
      "other.example.com",
    );
  });

  it("hides needed rows while all-sites access is on", async () => {
    await fakeBrowser.permissions.request({ origins: [ALL_SITES_ORIGIN] });
    const root = await mount(apiRuleOnly());

    expect(root.querySelector(`ul[aria-label="${text.neededHeading}"]`)).toBe(
      null,
    );
    // Under the broad grant there is nothing per-site left to say, so the panel
    // goes with its rows rather than answering "nothing granted yet" directly
    // under "All-sites access is on".
    expect(root.querySelector(".sa-card")?.textContent).toContain(
      text.allSites.on,
    );
    expect(root.textContent).not.toContain(copy.emptyState.siteAccess);
  });

  it("keeps narrow grants revocable while all-sites access stands", async () => {
    await fakeBrowser.permissions.request({
      origins: [originPatternForDomain("api.example.com")],
    });
    await fakeBrowser.permissions.request({ origins: [ALL_SITES_ORIGIN] });
    const root = await mount(apiRuleOnly());

    expect(group(root, text.grantedHeading).textContent).toContain(
      "api.example.com",
    );
  });

  it("announces that a narrow revoke leaves all-sites access standing", async () => {
    await fakeBrowser.permissions.request({ origins: [ALL_SITES_ORIGIN] });
    await grantOrigins("api.example.com");
    const root = await mount([profile("p1")]);

    fire(() => rowButton(root, text.revokeLabel("api.example.com")).click());
    await settle();

    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      text.revokedUnderAllSites("api.example.com"),
    );
    expect(root.textContent).toContain(text.allSites.on);
  });

  it("drives the standing initiator note from resource types", async () => {
    const withNote = await mount([
      profile("p1", {
        rules: [
          rule({
            scope: { type: "domains", domains: ["api.example.com"] },
            resourceTypes: ["xhr"],
          }),
        ],
      }),
    ]);
    expect(withNote.textContent).toContain(text.initiatorNote);
  });

  it("omits the note for navigation-only rules", async () => {
    const root = await mount([
      profile("p1", {
        rules: [
          rule({
            scope: { type: "domains", domains: ["api.example.com"] },
            resourceTypes: ["pages"],
          }),
        ],
      }),
    ]);
    expect(root.textContent).not.toContain(text.initiatorNote);
  });
});
