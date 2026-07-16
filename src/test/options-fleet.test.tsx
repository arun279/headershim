// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/options/App";
import type { Profile } from "../core/model";
import { originPatternForDomain } from "../core/scope";
import { read, write } from "../platform/store";
import { copy } from "../ui/copy";
import { profile, resetFixtures, rule, stateDoc } from "../ui/test/fixtures";
import { fire, render, settle } from "../ui/test/render";

const text = copy.options.fleet;

async function seed(profiles: Profile[]): Promise<void> {
  await write(stateDoc(profiles, { focusedProfileId: profiles[0]?.id ?? "" }));
}

async function mount(hash = "#fleet") {
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

describe("fleet by site", () => {
  it("groups rules by site and reads each in the severity grammar", async () => {
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
    await seed([
      profile("p1", { name: "Staging", rules: [rule({ header: "x-flag" })] }),
    ]);
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
});

describe("traffic receipt", () => {
  it("lists live and refused stamps and never records a value", async () => {
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
    // Secrets are never recorded: the tape carries header names, never values.
    expect(root.textContent).not.toContain("super-secret");
    expect(root.textContent).toContain(copy.options.traffic.secretsNote);
  });
});
