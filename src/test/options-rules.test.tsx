import { copy as editorCopy } from "../ui/copy.editor";
import { copy as optionsCopy, siteAccessCopy } from "../ui/copy.options";
// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App } from "../../entrypoints/options/App";
import { ALL_SITES_ORIGIN } from "../core/grants";
import type { Profile, Rule } from "../core/model";
import { originPatternForDomain } from "../core/scope";
import { setAppliedRevision } from "../platform/session-store";
import { read, write } from "../platform/store";
import { TRUNCATION_LIMITS } from "../ui/components/Truncate";
import { copy } from "../ui/copy";
import { profile, resetFixtures, rule, stateDoc } from "../ui/test/fixtures";
import { fire, render, settle } from "../ui/test/render";
import { followCurrentBatch, stopFollowingCurrentBatch } from "./applied";

const text = optionsCopy.options.allRules;

/** One enabled rule in one profile: the smallest list that has a row to act on. */
function oneRule(): Profile[] {
  return [
    profile("p1", { name: "Staging", rules: [rule({ header: "x-flag" })] }),
  ];
}

function domainScope(domain: string): Rule["scope"] {
  return { type: "domains", domains: [domain] };
}

async function seed(profiles: Profile[]): Promise<void> {
  await write(stateDoc(profiles, { activeProfileId: profiles[0]?.id ?? "" }));
}

async function mount(hash = "#rules", publish = true) {
  window.location.hash = hash;
  if (publish) await followCurrentBatch();
  const root = render(<App />);
  await settle();
  return root;
}

function within(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  return el;
}

function findButton(root: ParentNode, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`no button "${label}"`);
  return button;
}

beforeEach(() => {
  stopFollowingCurrentBatch();
  resetFixtures();
  window.location.hash = "";
});

/**
 * One rule of each severity the list has to tell apart: granted and running, a
 * grant away, and the Host rule Chrome always refuses.
 */
async function seedOneOfEachSeverity(): Promise<void> {
  await fakeBrowser.permissions.request({
    origins: [originPatternForDomain("api.example.com")],
  });
  await seed([
    profile("p1", {
      name: "Staging",
      rules: [
        rule({
          header: "x-live",
          scope: domainScope("api.example.com"),
        }),
        rule({
          header: "x-blocked",
          scope: domainScope("other.example.com"),
        }),
        rule({
          header: ":authority",
          scope: domainScope("api.example.com"),
        }),
        rule({
          header: "connection",
          scope: domainScope("api.example.com"),
        }),
      ],
    }),
  ]);
}

describe("all rules", () => {
  it("groups rules by site and reads each in the severity grammar", async () => {
    await seedOneOfEachSeverity();
    const root = await mount();

    fire(() => findButton(root, text.bySite).click());
    await settle();

    const hosts = [...root.querySelectorAll(".fleet-host")].map(
      (host) => host.textContent,
    );
    expect(hosts).toContain("api.example.com");
    expect(hosts).toContain("other.example.com");

    // A granted rule is live; the invalid header is refused; the h1-only rule
    // carries its transport caveat; the ungranted rule offers a Grant.
    expect(root.querySelector(".fleet-row.live")).not.toBeNull();
    expect(root.querySelector(".fleet-row.stop")).not.toBeNull();
    expect(
      [...root.querySelectorAll(".fleet-row")]
        .find((row) => row.textContent?.includes("connection"))
        ?.querySelector(".why")?.textContent,
    ).toContain(copy.advisories.h1Only);
    const blocked = [...root.querySelectorAll(".fleet-row.amber")].find(
      (row) => row.querySelector(".grant") !== null,
    );
    if (!(blocked instanceof HTMLElement)) {
      throw new Error("missing grantable rule");
    }
    expect(blocked.querySelector(".grant")?.textContent).toBe(
      copy.readout.grant,
    );
    expect(blocked.querySelector(".verb")?.textContent).toBe(
      copy.readout.heldVerb.set,
    );
    expect(blocked.querySelector(".why")?.textContent).toContain(
      copy.readout.needsAccessReason(false),
    );
  });

  it("keeps the running tone off the switch of a rule Chrome refuses", async () => {
    await seedOneOfEachSeverity();
    const root = await mount();

    // Every rule here is switched on. Refused and ungranted rules use the
    // blocked control tone, while a running rule keeps the live control tone
    // even when it carries a network caveat.
    const live = within(root, '.fleet-row.live [role="switch"]');
    const refused = within(root, '.fleet-row.stop [role="switch"]');
    const caveatedRow = [...root.querySelectorAll(".fleet-row")].find((row) =>
      row.textContent?.includes("connection"),
    );
    const caveated = caveatedRow?.querySelector('[role="switch"]');
    if (!(caveated instanceof HTMLElement)) {
      throw new Error("missing caveated switch");
    }
    const needsAccessRow = [...root.querySelectorAll(".fleet-row.amber")].find(
      (row) => row.querySelector(".grant") !== null,
    );
    const needsAccess = needsAccessRow?.querySelector('[role="switch"]');
    if (!(needsAccess instanceof HTMLElement)) {
      throw new Error("missing needs-access switch");
    }
    expect(live.getAttribute("aria-checked")).toBe("true");
    expect(refused.getAttribute("aria-checked")).toBe("true");
    expect(caveated.getAttribute("aria-checked")).toBe("true");
    expect(needsAccess.getAttribute("aria-checked")).toBe("true");
    expect(live.className).toBe("sw");
    expect(refused.className).toBe("sw sw-blocked");
    expect(caveated.className).toBe("sw");
    expect(needsAccess.className).toBe("sw sw-blocked");
  });

  it("does not project an out-of-sync ruleset", async () => {
    await seed(oneRule());
    await setAppliedRevision({ dynamic: "different", session: "different" });
    const root = await mount("#rules", false);
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(root.querySelector(".fleet-row")).not.toBeNull();
    expect(root.textContent).toContain(copy.readout.outOfSync);
  });

  it("keeps the scope beside the profile note for a rule in an inactive profile", async () => {
    const active = profile("p1", { name: "Active" });
    const inactive = profile("p2", {
      name: "Inactive",
      rules: [
        rule({
          header: "x-held",
          scope: { type: "domains", domains: ["held.example.com"] },
        }),
      ],
    });
    await seed([active, inactive]);
    const root = await mount();

    // The off-profile row states both what it matches and why it is at rest;
    // the reason must not take the scope's line.
    const row = within(root, ".fleet-row.rest");
    expect(row.querySelector(".fleet-scope")?.textContent).toBe(
      "held.example.com",
    );
    expect(row.textContent).toContain(
      copy.allRules.notActiveProfile("Inactive"),
    );
    expect(row.querySelector('[role="switch"]')?.className).toBe("sw sw-inert");
  });

  it("shows each cross-site rule's own pattern and regex, not a scope-kind word", async () => {
    fakeBrowser.declarativeNetRequest.isRegexSupported = vi.fn(async () => ({
      isSupported: true,
    }));
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [
          rule({
            header: "x-env",
            scope: {
              type: "pattern",
              pattern: "*://api.stripe.com/*",
              hosts: ["api.stripe.com"],
            },
          }),
          rule({
            header: "x-env",
            scope: { type: "regex", regex: "^https://gh\\.test/", hosts: [] },
          }),
        ],
      }),
    ]);
    const root = await mount();

    // The pattern and the regex are the only thing telling one cross-site rule
    // from the other, so each row carries its own expression.
    const scopes = [...root.querySelectorAll(".fleet-scope")].map(
      (node) => node.textContent,
    );
    expect(scopes).toContain("*://api.stripe.com/*");
    expect(scopes).toContain("^https://gh\\.test/");
  });

  it("truncates a long value to the ceiling every surface shares", async () => {
    const value = "a".repeat(600);
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [rule({ header: "x-flag", value })],
      }),
    ]);
    const root = await mount();

    const rendered = within(root, ".fleet-open .v");
    expect(rendered.textContent?.length).toBeLessThanOrEqual(
      TRUNCATION_LIMITS.value,
    );
    expect(rendered.title).toBe(value);
  });

  // A redaction marker is fixed text this product wrote, not the user's bytes.
  // Cut, "Bearer [hidden]" becomes "Bear…den]", which reads as a fragment of a
  // real value rather than as a value being withheld, so it is shown whole and
  // the header beside it gives up the room.
  it("shows a redaction marker whole, however narrow the row", async () => {
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [
          rule({
            header: "authorization",
            value: `Bearer ${"z".repeat(600)}`,
          }),
        ],
      }),
    ]);
    const root = await mount();

    const rendered = within(root, ".fleet-open .v");
    expect(rendered.textContent).toBe(`Bearer ${copy.rules.redacted}`);
    expect(rendered.textContent).not.toContain("…");
    expect(rendered.className).toContain("truncate-whole");
  });

  it("renders generated metadata in place of an absent literal value", async () => {
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [
          rule({
            header: "x-trace-id",
            value: "",
            generated: { kind: "uuid", at: "2026-07-12T14:03:00.000Z" },
          }),
        ],
      }),
    ]);
    const root = await mount();

    expect(within(root, ".fleet-open .v").textContent).toBe(
      copy.rules.generated(copy.rules.generatedKind.uuid),
    );
  });

  it("defaults to the by-header lens", async () => {
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [
          rule({
            header: "x-env",
            scope: { type: "domains", domains: ["a.com"] },
          }),
          rule({
            header: "x-env",
            scope: { type: "domains", domains: ["b.com"] },
          }),
        ],
      }),
    ]);
    const root = await mount();

    const heads = () =>
      [...root.querySelectorAll(".fleet-host")].map((head) => head.textContent);
    expect(
      root.querySelector("fieldset.segmented")?.getAttribute("aria-label"),
    ).toBe(text.lensLabel);
    // Both rules collapse under one header group.
    expect(heads()).toEqual(["x-env"]);
    expect(findButton(root, text.byHeader).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(findButton(root, text.bySite).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(findButton(root, text.newRule).className).toBe("btn primary");

    fire(() => findButton(root, text.bySite).click());
    await settle();
    expect(heads()).toEqual(["a.com", "b.com"]);

    fire(() => findButton(root, text.byHeader).click());
    await settle();
    expect(heads()).toEqual(["x-env"]);
    expect(findButton(root, text.byHeader).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("states all-sites reach unconditionally when the rule is running", async () => {
    await fakeBrowser.permissions.request({ origins: [ALL_SITES_ORIGIN] });
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [
          rule({
            header: "authorization",
            scope: { type: "domains", domains: ["api.example.com"] },
          }),
          rule({ header: "authorization", scope: { type: "all" } }),
        ],
      }),
    ]);
    const root = await mount();

    expect(within(root, ".fleet-count").textContent).toBe(
      `reaches ${text.scope.all}`,
    );
  });

  it("toggles a rule off from its switch", async () => {
    await seed(oneRule());
    const root = await mount();

    fire(() => within(root, '.fleet-row [role="switch"]').click());
    await settle();

    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(false);
  });

  it("opens the shared editor to author a new rule", async () => {
    await seed([profile("p1", { name: "Staging" })]);
    const root = await mount();

    fire(() => findButton(root, text.newRule).click());
    // The editor is a lazy chunk; wait for it to mount before asserting.
    await vi.waitFor(() => {
      if (root.querySelector('[role="combobox"]') === null) {
        throw new Error("rule editor is still loading");
      }
    });

    expect(document.activeElement).toBe(
      root.querySelector('[role="combobox"]'),
    );
  });

  // groupBySite draws one row per rule x domain, so a two-domain rule is two
  // rows whose switches are the same switch. The row has to own up to its reach.
  it("says how far a rule reaches when one rule is drawn under several sites", async () => {
    await fakeBrowser.permissions.request({
      origins: [
        originPatternForDomain("api.stripe.com"),
        originPatternForDomain("api.github.com"),
      ],
    });
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [
          rule({
            header: "x-env",
            scope: {
              type: "domains",
              domains: ["api.stripe.com", "api.github.com"],
            },
          }),
        ],
      }),
    ]);
    const root = await mount();

    fire(() => findButton(root, text.bySite).click());
    await settle();

    const rows = [...root.querySelectorAll(".fleet-row")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // The reach a shared switch carries is stated once, in the visible line,
      // not doubled into the switch's own accessible name.
      expect(row.textContent).toContain(text.sharedRule(2));
      expect(
        row.querySelector('[role="switch"]')?.getAttribute("aria-label"),
      ).toBe(copy.rules.switchLabel("x-env", true));
    }
  });

  it("leaves a single-site rule to say nothing about its reach", async () => {
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [
          rule({
            header: "x-env",
            scope: { type: "domains", domains: ["api.stripe.com"] },
          }),
        ],
      }),
    ]);
    const root = await mount();
    expect(root.textContent).not.toContain(text.sharedRule(2));
  });

  it("puts the one action in the empty state and nowhere else", async () => {
    await seed([profile("p1", { name: "Staging" })]);
    const root = await mount();

    expect(
      [...root.querySelectorAll("button")].filter(
        (button) => button.textContent === text.newRule,
      ),
    ).toHaveLength(1);
    expect(within(root, ".empty-state").textContent).toContain(text.empty);
    expect(root.querySelector(".segmented")).toBeNull();
  });
});

describe("rule delete", () => {
  it("deletes from the editor with no confirmation and restores on undo", async () => {
    await seed(oneRule());
    const root = await mount();

    fire(() => within(root, ".fleet-open").click());
    await vi.waitFor(() => {
      if (root.querySelector(".rule-editor") === null) {
        throw new Error("rule editor is still loading");
      }
    });

    fire(() => findButton(root, editorCopy.editor.delete).click());
    await settle();
    expect((await read()).profiles[0]?.rules).toEqual([]);
    expect(root.textContent).toContain(copy.toast.ruleDeleted);

    fire(() => findButton(root, copy.actions.undo).click());
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.header).toBe("x-flag");
  });
});

describe("active changes", () => {
  it("lists live and refused stamps and never carries a value", async () => {
    await fakeBrowser.permissions.request({
      origins: [originPatternForDomain("api.example.com")],
    });
    await seed([
      profile("p1", {
        name: "Staging",
        rules: [
          rule({
            header: "authorization",
            value: "Bearer super-secret",
            scope: domainScope("api.example.com"),
          }),
          rule({
            header: ":authority",
            scope: domainScope("api.example.com"),
          }),
          rule({
            header: "connection",
            scope: domainScope("api.example.com"),
          }),
          rule({ header: "x-off", enabled: false }),
        ],
      }),
    ]);
    const root = await mount("#traffic");

    expect(root.querySelector("#traffic-title")?.textContent).toBe(
      optionsCopy.options.traffic.title,
    );
    const rows = [...root.querySelectorAll(".tape-row")];
    expect(rows.length).toBe(3);
    expect(root.querySelector(".tape-row.stop")).not.toBeNull();
    expect(root.querySelector(".tape-row.live")).not.toBeNull();
    // Two independent facts on the caveated row: the status word says it is
    // installed and the caveat word carries the transport truth beside it.
    const caveated = rows.find((row) =>
      row.textContent?.includes("connection"),
    );
    expect(caveated?.classList.contains("amber")).toBe(true);
    expect(caveated?.querySelector(".tape-status")?.textContent).toBe(
      optionsCopy.options.traffic.status.live,
    );
    expect(caveated?.querySelector(".tape-caveat")?.textContent).toBe(
      optionsCopy.options.traffic.caveat.h1Only,
    );
    expect(root.querySelector(".tape-row.stop .tape-status")?.textContent).toBe(
      optionsCopy.options.traffic.status.refused,
    );
    expect(root.querySelector(".tape-row.stop .tape-caveat")).toBeNull();
    // The page carries header names, never values, so a secret cannot reach it.
    expect(root.textContent).not.toContain("super-secret");
  });

  it("uses a conditional verb when an active change needs access", async () => {
    await seed([
      profile("p1", {
        rules: [
          rule({
            header: "x-blocked",
            scope: { type: "domains", domains: ["api.example.com"] },
          }),
        ],
      }),
    ]);
    const root = await mount("#traffic");
    const row = within(root, ".tape-row.amber");

    expect(row.querySelector(".tape-verb")?.textContent).toBe(
      copy.readout.heldVerb.set,
    );
    // The Grant pill carries the access fact itself, so no "needs access"
    // status word doubles it.
    expect(row.querySelector(".tape-action")?.textContent).toBe(
      siteAccessCopy.grant,
    );
    expect(row.querySelector(".tape-status")).toBeNull();
  });

  it("keeps the caveat word beside the Grant action", async () => {
    await seed([
      profile("p1", {
        rules: [
          rule({
            header: "transfer-encoding",
            scope: domainScope("api.example.com"),
          }),
        ],
      }),
    ]);
    const root = await mount("#traffic");
    const row = within(root, ".tape-row.amber");

    expect(row.querySelector(".tape-action")?.textContent).toBe(
      siteAccessCopy.grant,
    );
    expect(row.querySelector(".tape-caveat")?.textContent).toBe(
      optionsCopy.options.traffic.caveat.h1Only,
    );
    expect(row.querySelector(".tape-status")).toBeNull();
  });

  it("keeps the status word and gains the caveat word on a cross-site row", async () => {
    await seed([
      profile("p1", {
        rules: [
          rule({
            header: "te",
            scope: { type: "pattern", pattern: "||example.com^", hosts: [] },
          }),
        ],
      }),
    ]);
    const root = await mount("#traffic");
    const row = within(root, ".tape-row");

    // A cross-site row names no single site to ask for, so no pill: the
    // status word stays, and te carries its own word because "breaks on
    // HTTP/2" is false for the one value HTTP/2 allows it.
    expect(row.querySelector(".tape-action")).toBeNull();
    expect(row.querySelector(".tape-status")?.textContent).toBe(
      optionsCopy.options.traffic.status.needsAccess,
    );
    expect(row.querySelector(".tape-caveat")?.textContent).toBe(
      optionsCopy.options.traffic.caveat.te,
    );
  });

  it("names and requests the projected initiator grant", async () => {
    await fakeBrowser.permissions.request({
      origins: [originPatternForDomain("api.example.com")],
    });
    await seed([
      profile("p1", {
        rules: [
          rule({
            header: "x-subresource",
            scope: { type: "domains", domains: ["api.example.com"] },
            resourceTypes: ["xhr"],
            initiators: ["app.example.com"],
          }),
        ],
      }),
    ]);
    const request = vi.spyOn(fakeBrowser.permissions, "request");
    const root = await mount("#traffic");
    const grant = root.querySelector(".tape-row .grant");
    if (!(grant instanceof HTMLButtonElement)) {
      throw new Error("missing Traffic grant");
    }
    const origins = [originPatternForDomain("app.example.com")];

    expect(grant.getAttribute("aria-label")).toBe(
      siteAccessCopy.grantOriginsLabel(origins),
    );
    fire(() => grant.click());
    expect(request).toHaveBeenCalledWith({ origins });
    request.mockRestore();
  });

  it("names shadowed and security-header rows", async () => {
    await fakeBrowser.permissions.request({
      origins: [originPatternForDomain("api.example.com")],
    });
    await write(
      stateDoc(
        [
          profile("p1", {
            rules: [
              rule({
                id: "winner",
                num: 1,
                direction: "response",
                header: "strict-transport-security",
                value: "max-age=63072000",
                scope: { type: "domains", domains: ["api.example.com"] },
              }),
              {
                id: "lower",
                num: 2,
                direction: "response",
                operation: "remove",
                header: "strict-transport-security",
                scope: { type: "domains", domains: ["api.example.com"] },
                resourceTypes: "all",
                initiators: [],
                enabled: true,
              },
            ],
          }),
        ],
        { nextRuleNum: 3 },
      ),
    );
    const root = await mount("#traffic");
    const rows = [...root.querySelectorAll(".tape-row")];
    const statuses = rows.map(
      (row) => row.querySelector(".tape-status")?.textContent,
    );

    expect(statuses).toContain(optionsCopy.options.traffic.status.live);
    expect(statuses).toContain(optionsCopy.options.traffic.status.overridden);
  });

  it("reports a refused security header as refused", async () => {
    await fakeBrowser.permissions.request({
      origins: [originPatternForDomain("api.example.com")],
    });
    await seed([
      profile("p1", {
        rules: [
          rule({
            direction: "response",
            header: "content-security-policy",
            value: "default-src 'none'\nbad",
            scope: {
              type: "domains",
              domains: ["api.example.com"],
            },
          }),
        ],
      }),
    ]);

    const root = await mount("#traffic");
    const row = root.querySelector(".tape-row");
    expect(row?.classList.contains("stop")).toBe(true);
    expect(row?.querySelector(".tape-status")?.textContent).toBe(
      optionsCopy.options.traffic.status.refused,
    );
  });

  it("keeps the needs-access glyph while paused", async () => {
    await write(
      stateDoc(
        [
          profile("p1", {
            rules: [
              rule({
                header: "x-blocked",
                scope: { type: "domains", domains: ["api.example.com"] },
              }),
            ],
          }),
        ],
        { settings: { paused: true, theme: "system" } },
      ),
    );
    const root = await mount("#traffic");
    const row = within(root, ".tape-row.amber");

    expect(row.querySelector(".tape-mark circle")).not.toBeNull();
    expect(row.querySelector(".tape-mark rect")).toBeNull();
  });

  // The page is the active profile's switched-on changes, so an enabled rule in
  // another profile leaves it empty; the empty line states that fact and never
  // tells the reader to turn on a rule the active profile does not hold.
  it("stays empty when only another profile has a switched-on rule", async () => {
    await seed([
      profile("p1", { name: "Active", rules: [] }),
      profile("p2", {
        name: "Other",
        rules: [rule({ header: "x-flag" })],
      }),
    ]);
    const root = await mount("#traffic");

    expect(root.querySelector(".tape-list")).toBeNull();
    expect(within(root, ".tape-empty").textContent).toContain(
      optionsCopy.options.traffic.empty,
    );
    expect(root.textContent).not.toContain("Turn a rule on");
  });
});
