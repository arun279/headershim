// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/options/App";
import type { Profile } from "../core/model";
import { originPatternForDomain } from "../core/scope";
import { read, write } from "../platform/store";
import { TRUNCATION_LIMITS } from "../ui/components/Truncate";
import { copy } from "../ui/copy";
import { profile, resetFixtures, rule, stateDoc } from "../ui/test/fixtures";
import { fire, render, settle } from "../ui/test/render";

const text = copy.options.allRules;

/** One enabled rule in one profile: the smallest list that has a row to act on. */
function oneRule(): Profile[] {
  return [
    profile("p1", { name: "Staging", rules: [rule({ header: "x-flag" })] }),
  ];
}

async function seed(profiles: Profile[]): Promise<void> {
  await write(stateDoc(profiles, { activeProfileId: profiles[0]?.id }));
}

async function mount(hash = "#rules") {
  window.location.hash = hash;
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
          scope: { type: "domains", domains: ["api.example.com"] },
        }),
        rule({
          header: "x-blocked",
          scope: { type: "domains", domains: ["other.example.com"] },
        }),
        rule({
          header: "host",
          scope: { type: "domains", domains: ["api.example.com"] },
        }),
      ],
    }),
  ]);
}

describe("all rules by site", () => {
  it("groups rules by site and reads each in the severity grammar", async () => {
    await seedOneOfEachSeverity();
    const root = await mount();

    const hosts = [...root.querySelectorAll(".fleet-host")].map(
      (host) => host.textContent,
    );
    expect(hosts).toContain("api.example.com");
    expect(hosts).toContain("other.example.com");

    // A granted rule is live; the Host rule is refused; the ungranted rule needs
    // access and offers a Grant.
    expect(root.querySelector(".fleet-row.live")).not.toBeNull();
    expect(root.querySelector(".fleet-row.refused")).not.toBeNull();
    const blocked = within(root, ".fleet-row.needs-access");
    expect(blocked.querySelector(".grant")?.textContent).toBe(
      copy.readout.grant,
    );
  });

  it("keeps the running tone off the switch of a rule Chrome refuses", async () => {
    await seedOneOfEachSeverity();
    const root = await mount();

    // Both rules are switched on, but only one of them is running: a refused
    // rule wearing the live hue contradicts the reason printed beside it.
    const live = within(root, '.fleet-row.live [role="switch"]');
    const refused = within(root, '.fleet-row.refused [role="switch"]');
    expect(live.getAttribute("aria-checked")).toBe("true");
    expect(refused.getAttribute("aria-checked")).toBe("true");
    expect(live.className).toBe("sw");
    expect(refused.className).toBe("sw sw-blocked");
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

  it("switches to the by-header lens", async () => {
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

    fire(() => findButton(root, text.byHeader).click());
    await settle();

    const heads = [...root.querySelectorAll(".fleet-host")].map(
      (head) => head.textContent,
    );
    // Both rules collapse under one header group.
    expect(heads).toEqual(["x-env"]);
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

    const rows = [...root.querySelectorAll(".fleet-row")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.textContent).toContain(text.alsoOn(1));
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
    expect(root.textContent).not.toContain(text.alsoOn(1));
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
    expect(root.querySelector(".seg")).toBeNull();
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

    fire(() => findButton(root, copy.editor.delete).click());
    await settle();
    expect((await read()).profiles[0]?.rules).toEqual([]);
    expect(root.textContent).toContain(copy.toast.ruleDeleted);

    fire(() => findButton(root, copy.actions.undo).click());
    await settle();
    expect((await read()).profiles[0]?.rules[0]?.header).toBe("x-flag");
  });
});

describe("what runs", () => {
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
            scope: { type: "domains", domains: ["api.example.com"] },
          }),
          rule({
            header: "host",
            scope: { type: "domains", domains: ["api.example.com"] },
          }),
          rule({ header: "x-off", enabled: false }),
        ],
      }),
    ]);
    const root = await mount("#traffic");

    const rows = [...root.querySelectorAll(".tape-row")];
    expect(rows.length).toBe(2);
    expect(root.querySelector(".tape-row.refused")).not.toBeNull();
    expect(root.querySelector(".tape-row.live")).not.toBeNull();
    // The page carries header names, never values, so a secret cannot reach it.
    expect(root.textContent).not.toContain("super-secret");
  });
});
