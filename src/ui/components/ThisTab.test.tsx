// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { MAX_SESSION_OVERRIDES } from "../../core/limits";
import type { TabOverride } from "../../core/model";
import { read as readSession, write } from "../../platform/session-store";
import { tabOverride } from "../../test/dnr-harness";
import { copy } from "../copy";
import { fire, press, render, settle, typeInto } from "../test/render";
import { ThisTab } from "./ThisTab";

const override = (overrides: Partial<TabOverride> = {}): TabOverride =>
  tabOverride({ header: "x-debug-trace", value: "1", ...overrides });

const noop = () => {};

function mount(props: Partial<Parameters<typeof ThisTab>[0]> = {}) {
  return render(
    <ThisTab
      tabId={5}
      host="app.example.com"
      overrides={[]}
      composing={false}
      onOpenComposer={noop}
      onSaveAsRule={noop}
      onCloseComposer={noop}
      {...props}
    />,
  );
}

function valueField(root: HTMLElement): HTMLTextAreaElement {
  return root.querySelector(
    ".this-tab-composer .compose-value-input",
  ) as HTMLTextAreaElement;
}

async function submit(root: HTMLElement, header: string, value: string) {
  typeInto(root.querySelector('[role="combobox"]') as HTMLInputElement, header);
  typeInto(valueField(root), value);
  const add = [...root.querySelectorAll("button")].find(
    (button) => button.textContent === copy.actions.addOverride,
  ) as HTMLButtonElement;
  fire(() => add.click());
  await settle();
}

describe("ThisTab", () => {
  it("always renders the host, one lifecycle caption, and the composer action", () => {
    const onOpenComposer = vi.fn();
    const root = mount({ onOpenComposer });
    expect(root.querySelector(".this-tab-head")?.textContent).toContain(
      "This tab · app.example.com",
    );
    expect(root.querySelector(".this-tab-lifecycle")?.textContent).toBe(
      "clears when you close or leave this tab",
    );
    const add = [...root.querySelectorAll("button")].find(
      (button) => button.textContent === "+ Temporary override",
    ) as HTMLButtonElement;
    fire(() => add.click());
    expect(onOpenComposer).toHaveBeenCalledOnce();
  });

  it("renders a redaction-safe row without per-row temporary lifecycle copy", () => {
    const root = mount({ overrides: [override()] });
    const row = root.querySelector(".this-tab-row") as HTMLElement;
    expect(row.textContent).toContain("x-debug-trace");
    expect(row.textContent).not.toContain("Temporary");
    expect(row.textContent).not.toContain("clears when");

    const secret = mount({
      overrides: [override({ header: "x-service-token", value: "secret" })],
    });
    expect(secret.textContent).toContain("…redacted");
    expect(secret.textContent).not.toContain("secret");
  });

  it("commits a new override from the composer into the session store", async () => {
    const onCloseComposer = vi.fn();
    const root = mount({ composing: true, onCloseComposer });

    await submit(root, "x-a", "42");

    const session = await readSession();
    expect(session.tabs[5]).toMatchObject([
      { tabId: 5, originHost: "app.example.com", header: "x-a", value: "42" },
    ]);
    expect(onCloseComposer).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary Enter and focus changes from committing a draft", async () => {
    const onCloseComposer = vi.fn();
    const root = mount({ composing: true, onCloseComposer });
    const header = root.querySelector('[role="combobox"]') as HTMLInputElement;
    const value = valueField(root);
    typeInto(header, "x-a");
    typeInto(value, "42");

    fire(() => {
      value.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      value.blur();
    });
    await settle();

    expect((await readSession()).tabs[5]).toBeUndefined();
    expect(onCloseComposer).not.toHaveBeenCalled();
    expect(root.querySelector(".this-tab-composer")).not.toBeNull();
  });

  it("commits the composer with Ctrl+Enter", async () => {
    const onCloseComposer = vi.fn();
    const root = mount({ composing: true, onCloseComposer });
    const value = valueField(root);
    typeInto(
      root.querySelector('[role="combobox"]') as HTMLInputElement,
      "x-a",
    );
    typeInto(value, "42");

    fire(() => {
      value.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settle();

    expect((await readSession()).tabs[5]?.[0]).toMatchObject({
      header: "x-a",
      value: "42",
    });
    expect(onCloseComposer).toHaveBeenCalledOnce();
  });

  it("surfaces the session cap inline without writing", async () => {
    await write({
      nextNum: MAX_SESSION_OVERRIDES + 1,
      tabs: {
        9: Array.from({ length: MAX_SESSION_OVERRIDES }, (_, index) => ({
          ...override({ tabId: 9 }),
          num: index + 1,
        })),
      },
    });
    const onCloseComposer = vi.fn();
    const root = mount({ composing: true, onCloseComposer });

    await submit(root, "x-a", "42");

    expect(root.querySelector(".editor-error-global")?.textContent).toContain(
      "temporary tab rules",
    );
    expect((await readSession()).tabs[5]).toBeUndefined();
    expect(onCloseComposer).not.toHaveBeenCalled();
  });

  it("explains that a non-web tab can't take an override", () => {
    const root = mount({ composing: true, host: undefined, tabId: undefined });
    expect(root.querySelector(".this-tab-note")?.textContent).toContain(
      "Open the popup on a website",
    );
    expect(root.querySelector(".this-tab-composer")).toBeNull();
  });

  it("offers Edit value, Save as rule, and Delete from the row menu", () => {
    const onSaveAsRule = vi.fn();
    const row = override();
    const root = mount({ overrides: [row], onSaveAsRule });

    fire(() =>
      (root.querySelector(".this-tab-menu-btn") as HTMLButtonElement).click(),
    );
    const menu = root.querySelector(".this-tab-menu") as HTMLElement;
    expect(menu.getAttribute("popover")).toBe("manual");
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Edit value", "Save as rule…", "Delete"]);
    const items = [
      ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    expect(document.activeElement).toBe(items[0]);
    press(items[0] as HTMLButtonElement, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    const save = [...menu.querySelectorAll("button")].find(
      (button) => button.textContent === "Save as rule…",
    ) as HTMLButtonElement;
    fire(() => save.click());
    expect(onSaveAsRule).toHaveBeenCalledWith(row);
  });

  it("disables a temporary override without deleting it", async () => {
    await write({ nextNum: 2, tabs: { 5: [override()] } });
    const root = mount({ overrides: [override()] });
    const toggle = root.querySelector(".this-tab-row .sw") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fire(() => toggle.click());
    await settle();

    expect((await readSession()).tabs[5]?.[0]).toMatchObject({
      enabled: false,
      header: "x-debug-trace",
    });
  });

  it("opens a masked empty secret editor and a complete non-secret editor", () => {
    const plain = mount({
      overrides: [override({ value: "complete-value-that-is-not-a-summary" })],
    });
    fire(() =>
      (plain.querySelector(".rule-value-button") as HTMLButtonElement).click(),
    );
    const plainInput = plain.querySelector(
      ".inline-value-input",
    ) as HTMLInputElement;
    expect(plainInput.type).toBe("text");
    expect(plainInput.value).toBe("complete-value-that-is-not-a-summary");
    expect(document.activeElement).toBe(plainInput);

    const secret = mount({
      overrides: [override({ header: "authorization", value: "Bearer token" })],
    });
    fire(() =>
      (secret.querySelector(".rule-value-button") as HTMLButtonElement).click(),
    );
    const secretInput = secret.querySelector(
      ".inline-value-input",
    ) as HTMLInputElement;
    expect(secretInput.type).toBe("password");
    expect(secretInput.value).toBe("");
    expect(secretInput.placeholder).toBe("Paste new value");
    const cancel = secret.querySelector(
      '.inline-value-action[aria-label="Cancel"]',
    ) as HTMLButtonElement;
    expect(cancel.querySelector("svg")).not.toBeNull();
    expect(cancel.textContent).toBe("");
  });

  it("removes a row from the session store", async () => {
    await write({ nextNum: 2, tabs: { 5: [override()] } });
    const root = mount({ overrides: [override()] });

    fire(() =>
      (root.querySelector(".this-tab-menu-btn") as HTMLButtonElement).click(),
    );
    const remove = [...root.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Delete",
    ) as HTMLButtonElement;
    fire(() => remove.click());
    await settle();

    expect((await readSession()).tabs).toEqual({});
  });

  it("moves focus to a surviving row control when a middle row is removed", () => {
    const root = mount({
      overrides: [
        override({ num: 1, header: "x-a" }),
        override({ num: 2, header: "x-b" }),
        override({ num: 3, header: "x-c" }),
      ],
    });
    const menus = [
      ...root.querySelectorAll(".this-tab-menu-btn"),
    ] as HTMLButtonElement[];
    fire(() => menus[1]?.click());
    const remove = [...root.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Delete",
    ) as HTMLButtonElement;
    fire(() => remove.click());

    const rows = [...root.querySelectorAll(".this-tab-row")];
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(rows[2]?.querySelector(".sw"));
  });
});
