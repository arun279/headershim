// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App as OptionsApp } from "../../entrypoints/options/App";
import { ALL_SITES_ORIGIN } from "../core/grants";
import type { Profile, Rule } from "../core/model";
import { originPatternForDomain } from "../core/scope";
import { write as writeSession } from "../platform/session-store";
import { write } from "../platform/store";
import { copy, sentenceText, siteAccessCopy } from "../ui/copy";
import { profile, resetFixtures, rule, stateDoc } from "../ui/test/fixtures";
import { findButton, fire, render, settle } from "../ui/test/render";

const text = siteAccessCopy;

async function mount(profiles: Profile[]): Promise<HTMLElement> {
  await write(stateDoc(profiles));
  window.location.hash = "#site-access";
  const root = render(<OptionsApp />);
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

async function revokeRow(root: HTMLElement, domain: string): Promise<void> {
  fire(() => rowButton(root, text.revokeLabel(domain)).click());
  await settle();
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

  it("explains where rows come from and what Chrome controls can do", async () => {
    const root = await mount([profile("p1")]);

    expect(root.querySelector(".sa-guidance")?.textContent).toBe(text.guidance);
    expect(
      [...root.querySelectorAll("button")].some((button) =>
        /\badd\b/i.test(
          `${button.textContent} ${button.getAttribute("aria-label") ?? ""}`,
        ),
      ),
    ).toBe(false);
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
    expect(needed.textContent).toContain(
      `${text.usageLead("none")} ${text.ruleCount(2)}`,
    );
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

    await revokeRow(root, "api.example.com");

    expect(group(root, text.neededHeading).textContent).toContain(
      "api.example.com",
    );
    expect(root.querySelector(`ul[aria-label="${text.grantedHeading}"]`)).toBe(
      null,
    );
  });

  it("shows this-tab use and keeps it needed after revocation", async () => {
    await grantOrigins("api.example.com");
    await writeSession({
      nextNum: 2,
      tabs: {
        5: [
          {
            num: 1,
            tabId: 5,
            origin: "https://api.example.com",
            direction: "request",
            operation: "set",
            header: "x-session",
            value: "1",
            enabled: true,
          },
        ],
      },
    });
    const root = await mount([profile("p1")]);
    const granted = group(root, text.grantedHeading);

    expect(granted.textContent).toContain(text.tabCount(1));
    expect(granted.textContent).not.toContain(text.ruleCount(0));

    await revokeRow(root, "api.example.com");

    expect(group(root, text.neededHeading).textContent).toContain(
      `${text.usageLead("none")} ${text.tabCount(1)}`,
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

  it("shows one limited row for Chrome's narrowed grant", async () => {
    const observed = "https://api.example.com/*";
    await fakeBrowser.permissions.request({ origins: [observed] });
    const root = await mount(apiRuleOnly());

    const limited = group(root, text.partialHeading);
    expect(limited.querySelectorAll("li")).toHaveLength(1);
    expect(limited.textContent).toContain("api.example.com");
    expect(limited.textContent).toContain(text.usageLead("partial"));
    expect(limited.textContent).toContain(
      sentenceText(text.partial([observed])),
    );
    expect(root.querySelector(`ul[aria-label="${text.neededHeading}"]`)).toBe(
      null,
    );
    expect(root.querySelector(`ul[aria-label="${text.grantedHeading}"]`)).toBe(
      null,
    );
    expect(
      rowButton(root, text.broadenLabel("api.example.com")).textContent,
    ).toBe(text.broaden);
    expect(
      rowButton(root, text.revokeLabel("api.example.com")).textContent,
    ).toBe(text.revoke);

    await revokeRow(root, "api.example.com");

    expect(
      await fakeBrowser.permissions.contains({ origins: [observed] }),
    ).toBe(false);
    expect(group(root, text.neededHeading).textContent).toContain(
      "api.example.com",
    );
  });

  it("shows parent coverage without revoking it from the child row", async () => {
    const parent = "https://*.example.com/*";
    await fakeBrowser.permissions.request({ origins: [parent] });
    const root = await mount(apiRuleOnly());

    expect(group(root, text.partialHeading).textContent).toContain(
      sentenceText(text.partial([parent])),
    );
    expect(group(root, text.grantedHeading).textContent).toContain(
      "example.com",
    );
    expect(
      root.querySelector(
        `button[aria-label="${text.revokeLabel("api.example.com")}"]`,
      ),
    ).toBeNull();
    expect(rowButton(root, text.revokeLabel("example.com")).textContent).toBe(
      text.revoke,
    );
  });

  it("removes only direct grants while parent coverage remains", async () => {
    const direct = "https://api.example.com/*";
    const parent = "https://*.example.com/*";
    await fakeBrowser.permissions.request({ origins: [direct, parent] });
    const root = await mount(apiRuleOnly());

    await revokeRow(root, "api.example.com");

    expect(await fakeBrowser.permissions.contains({ origins: [direct] })).toBe(
      false,
    );
    expect(await fakeBrowser.permissions.contains({ origins: [parent] })).toBe(
      true,
    );
    expect(group(root, text.partialHeading).textContent).toContain(
      sentenceText(text.partial([parent])),
    );
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      text.revoked("api.example.com"),
    );
  });

  it("keeps a long full row beside a partial row with several grants", async () => {
    const partialDomain = "api.example.com";
    const longDomain =
      "service-with-a-very-long-name.internal.example-development.test";
    const partialOrigins = [
      `https://${partialDomain}/*`,
      `http://${partialDomain}:8080/*`,
      `https://*.${partialDomain}/*`,
      `http://*.${partialDomain}:8081/*`,
      `https://${partialDomain}:8443/*`,
      `http://${partialDomain}:9090/*`,
    ];
    await fakeBrowser.permissions.request({ origins: partialOrigins });
    await grantOrigins(longDomain);
    const root = await mount([
      profile("p1", {
        rules: [
          rule({ scope: { type: "domains", domains: [partialDomain] } }),
          rule({ scope: { type: "domains", domains: [longDomain] } }),
        ],
      }),
    ]);

    const limited = group(root, text.partialHeading);
    expect(limited.textContent).toContain(partialDomain);
    expect(limited.textContent).toContain(
      sentenceText(text.partial(partialOrigins)),
    );
    expect(rowButton(root, text.revokeLabel(partialDomain)).textContent).toBe(
      text.revoke,
    );
    expect(group(root, text.grantedHeading).textContent).toContain(longDomain);
  });

  it("groups same-domain grants and revokes them together", async () => {
    const observed = "https://api.example.com/*";
    const broad = originPatternForDomain("api.example.com");
    await fakeBrowser.permissions.request({ origins: [observed] });
    await fakeBrowser.permissions.request({ origins: [broad] });
    const root = await mount(apiRuleOnly());

    const granted = group(root, text.grantedHeading);
    expect(granted.querySelectorAll("li")).toHaveLength(1);

    await revokeRow(root, "api.example.com");

    expect(
      await fakeBrowser.permissions.contains({ origins: [observed] }),
    ).toBe(false);
    expect(await fakeBrowser.permissions.contains({ origins: [broad] })).toBe(
      false,
    );
  });

  it("shows the honest all-sites card and swaps it for the revoke line after grant", async () => {
    const root = await mount([profile("p1")]);

    expectAllSitesCollapsed(root);
    expect(root.textContent).not.toContain(text.allSites.on);

    const disclosure = root.querySelector<HTMLButtonElement>(".sa-disclosure");
    if (disclosure === null) throw new Error("no all-sites disclosure");
    expect(disclosure.textContent).toContain(text.allSites.disclosure);
    fire(() => disclosure.click());
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
    expect(findButton(root, text.allSites.revoke).textContent).toBe(
      text.allSites.revoke,
    );

    fire(() => findButton(root, text.allSites.revoke).click());
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

  it("does not count broad sensitive rules in inactive profiles", async () => {
    const root = await mount([
      profile("p1"),
      profile("p2", {
        rules: [
          rule({
            operation: "set",
            header: "authorization",
            scope: { type: "all" },
          }),
        ],
      }),
    ]);

    openAllSitesReview(root);
    expect(root.querySelector(".sa-all-caution")).toBeNull();
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

  it("keeps narrow grants visible and individually revocable under all-sites access", async () => {
    await fakeBrowser.permissions.request({
      origins: [originPatternForDomain("api.example.com")],
    });
    await fakeBrowser.permissions.request({ origins: [ALL_SITES_ORIGIN] });
    const root = await mount(apiRuleOnly());

    expect(group(root, text.grantedHeading).textContent).toContain(
      "api.example.com",
    );
    await revokeRow(root, "api.example.com");

    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      text.revokedUnderAllSites("api.example.com"),
    );
    expect(
      await fakeBrowser.permissions.contains({
        origins: [originPatternForDomain("api.example.com")],
      }),
    ).toBe(false);
    expect(root.textContent).toContain(text.allSites.on);
    expect(
      await fakeBrowser.permissions.contains({ origins: [ALL_SITES_ORIGIN] }),
    ).toBe(true);
  });

  it("announces a declined grant", async () => {
    vi.spyOn(fakeBrowser.permissions, "request").mockImplementationOnce(
      async (): Promise<boolean> => false,
    );
    const root = await mount(apiRuleOnly());

    fire(() => rowButton(root, text.grantLabel("api.example.com")).click());
    await settle();

    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      text.notGranted("api.example.com"),
    );
  });

  it("disables permission actions while one is pending", async () => {
    let resolveRequest: ((granted: boolean) => void) | undefined;
    const request = vi
      .spyOn(fakeBrowser.permissions, "request")
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRequest = resolve;
          }),
      );
    const root = await mount(apiRuleOnly());
    const grant = rowButton(root, text.grantLabel("api.example.com"));

    fire(() => grant.click());
    expect(grant.disabled).toBe(true);
    fire(() => grant.click());
    expect(request).toHaveBeenCalledTimes(1);

    if (resolveRequest === undefined) throw new Error("request did not start");
    resolveRequest(false);
    await settle();

    expect(rowButton(root, text.grantLabel("api.example.com")).disabled).toBe(
      false,
    );
  });

  it("announces a declined broaden without denying existing access", async () => {
    const observed = "https://api.example.com/*";
    await fakeBrowser.permissions.request({ origins: [observed] });
    vi.spyOn(fakeBrowser.permissions, "request").mockImplementationOnce(
      async (): Promise<boolean> => false,
    );
    const root = await mount(apiRuleOnly());

    fire(() => rowButton(root, text.broadenLabel("api.example.com")).click());
    await settle();

    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      text.notBroadened("api.example.com"),
    );
    expect(
      await fakeBrowser.permissions.contains({ origins: [observed] }),
    ).toBe(true);
  });

  it("announces a rejected revoke", async () => {
    await grantOrigins("api.example.com");
    const root = await mount(apiRuleOnly());
    vi.spyOn(fakeBrowser.permissions, "remove").mockRejectedValueOnce(
      new Error("permission is required"),
    );

    await revokeRow(root, "api.example.com");

    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      text.revokeFailed("api.example.com"),
    );
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
