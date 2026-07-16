// @vitest-environment happy-dom
import { fakeBrowser } from "@webext-core/fake-browser";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/popup/App";
import {
  createRule,
  type RuleDraft,
  type StateDoc,
  type TabOverride,
} from "../core/model";
import { createV1Seed } from "../core/schema";
import {
  read as readSession,
  write as writeSession,
} from "../platform/session-store";
import { read as readState, write } from "../platform/store";
import { fire, press, render, settle, typeInto } from "../ui/test/render";
import { tabOverride } from "./dnr-harness";

// The popup's tab is pinned so This-tab writes bind to a known origin.
vi.mock("../platform/tabs", () => ({
  activeTabId: () => Promise.resolve(5),
  activeTabDomain: () => Promise.resolve("app.example.com"),
}));

const override = (overrides: Partial<TabOverride> = {}): TabOverride =>
  tabOverride({ header: "x-debug-trace", value: "1", ...overrides });

function withSavedRule(): StateDoc {
  const seed = createV1Seed();
  const draft: RuleDraft = {
    direction: "request",
    operation: "set",
    header: "x-existing",
    value: "1",
    scope: { type: "domains", domains: ["app.example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
  };
  const [rule, next] = createRule(seed, draft);
  return {
    ...next,
    profiles: next.profiles.map((profile, index) =>
      index === 0 ? { ...profile, rules: [rule] } : profile,
    ),
  };
}

async function mount(
  doc: StateDoc,
  session?: Parameters<typeof writeSession>[0],
) {
  await write(doc);
  if (session !== undefined) {
    await writeSession(session);
  }
  const root = render(<App />);
  await settle();
  return root;
}

function valueField(root: HTMLElement): HTMLTextAreaElement {
  return root.querySelector(
    ".this-tab-composer .compose-value-input",
  ) as HTMLTextAreaElement;
}

function openTemporaryMenu(root: HTMLElement): void {
  fire(() =>
    (root.querySelector(".this-tab-menu-btn") as HTMLButtonElement).click(),
  );
}

describe("popup This-tab wiring", () => {
  it("opens the composer with t and commits a temporary row", async () => {
    const root = await mount(createV1Seed());

    press(root.querySelector(".popup") as HTMLElement, "t");
    await settle();
    expect(root.querySelector(".this-tab-composer")).not.toBeNull();

    typeInto(
      root.querySelector('[role="combobox"]') as HTMLInputElement,
      "x-a",
    );
    typeInto(valueField(root), "42");
    const add = [...root.querySelectorAll("button")].find(
      (button) => button.textContent === "Add override",
    ) as HTMLButtonElement;
    fire(() => add.click());
    await settle();

    expect(root.querySelector(".this-tab-composer")).toBeNull();
    expect((await readSession()).tabs[5]).toMatchObject([
      { header: "x-a", value: "42", originHost: "app.example.com" },
    ]);
    expect(root.querySelector(".this-tab-row")?.textContent).toContain("x-a");
    // The annunciator reflects the temporary override.
    expect(root.querySelector(".annunciator")?.textContent).toContain(
      "1 temporary on this tab",
    );
  });

  it("opens the composer from the first-run Try it on this tab action", async () => {
    const root = await mount(createV1Seed());
    const tryIt = [...root.querySelectorAll(".first-run-actions button")].find(
      (button) => button.textContent === "Try it on this tab",
    ) as HTMLButtonElement;

    fire(() => tryIt.click());
    await settle();

    expect(root.querySelector(".this-tab-composer")).not.toBeNull();
    expect(root.querySelector(".first-run")).toBeNull();
  });

  it("promotes a row into a pre-filled rule editor via Save as rule…", async () => {
    const root = await mount(createV1Seed(), {
      nextNum: 2,
      tabs: { 5: [override()] },
    });

    openTemporaryMenu(root);
    const save = [...root.querySelectorAll('[role="menuitem"]')].find(
      (button) => button.textContent === "Save as rule…",
    ) as HTMLButtonElement;
    fire(() => save.click());
    await settle();

    expect(root.querySelector(".rule-editor")).not.toBeNull();
    expect(
      (root.querySelector('[role="combobox"]') as HTMLInputElement).value,
    ).toBe("x-debug-trace");
    expect(
      (root.querySelector(".value-row textarea") as HTMLTextAreaElement).value,
    ).toBe("1");
    expect(root.querySelector(".rule-editor")?.textContent).toContain(
      "app.example.com",
    );
  });

  it("promotes a temporary row through save-and-allow and keeps a declined rule blocked", async () => {
    vi.spyOn(fakeBrowser.permissions, "request").mockResolvedValueOnce(false);
    const original = override();
    const root = await mount(withSavedRule(), {
      nextNum: 2,
      tabs: { 5: [original] },
    });

    openTemporaryMenu(root);
    const promote = [...root.querySelectorAll('[role="menuitem"]')].find(
      (button) => button.textContent === "Save as rule…",
    ) as HTMLButtonElement;
    fire(() => promote.click());
    await settle();
    const create = [...root.querySelectorAll(".editor-actions button")].find(
      (button) =>
        button.textContent === "Create rule and allow app.example.com",
    ) as HTMLButtonElement;
    fire(() => create.click());
    await settle();

    expect(root.querySelector(".rule-editor")).toBeNull();
    expect((await readSession()).tabs[5]).toBeUndefined();
    expect(
      (await readState()).profiles[0]?.rules.map((rule) => rule.header),
    ).toEqual(["x-existing", "x-debug-trace"]);
    expect(root.querySelectorAll(".rule-row.blocked").length).toBeGreaterThan(
      0,
    );
    expect(root.querySelector(".toast")?.textContent).toContain(
      "Saved, but not running",
    );
  });

  it("prunes a stale-origin override on popup open", async () => {
    await mount(createV1Seed(), {
      nextNum: 2,
      tabs: { 5: [override({ originHost: "old.example.com" })] },
    });
    await settle();

    expect((await readSession()).tabs).toEqual({});
  });
});
