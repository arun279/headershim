// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { MAX_SESSION_OVERRIDES } from "../../core/limits";
import type { TabOverride } from "../../core/model";
import { read as readSession, write } from "../../platform/session-store";
import { tabOverride } from "../../test/dnr-harness";
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
      onSaveAsRule={noop}
      onCreateRule={noop}
      onCloseComposer={noop}
      {...props}
    />,
  );
}

function valueField(root: HTMLElement): HTMLInputElement {
  return root.querySelector(
    '.this-tab-composer input[type="text"]:not([role])',
  ) as HTMLInputElement;
}

async function submit(root: HTMLElement, header: string, value: string) {
  typeInto(root.querySelector('[role="combobox"]') as HTMLInputElement, header);
  typeInto(valueField(root), value);
  press(valueField(root), "Enter");
  await settle();
}

describe("ThisTab", () => {
  it("renders nothing until it has a row or an open composer", () => {
    const root = mount();
    expect(root.querySelector(".this-tab")).toBeNull();
  });

  it("renders a temporary row with the header, value, and section summary", () => {
    const root = mount({ overrides: [override()] });
    expect(root.querySelector(".this-tab-head")?.textContent).toContain(
      "app.example.com",
    );
    expect(root.querySelector(".this-tab-head")?.textContent).toContain(
      "1 temporary",
    );
    const row = root.querySelector(".this-tab-row") as HTMLElement;
    expect(row.textContent).toContain("x-debug-trace");
    expect(row.textContent).toContain("Temporary");
    expect(row.textContent).toContain("applies to");
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

  it("promotes a row through Save as rule…", () => {
    const onSaveAsRule = vi.fn();
    const row = override();
    const root = mount({ overrides: [row], onSaveAsRule });

    const save = [...root.querySelectorAll("button")].find(
      (button) => button.textContent === "Save as rule…",
    ) as HTMLButtonElement;
    fire(() => save.click());
    expect(onSaveAsRule).toHaveBeenCalledWith(row);
  });

  it("routes the standing honesty line's Create a rule action", () => {
    const onCreateRule = vi.fn();
    const root = mount({ overrides: [override()], onCreateRule });
    const note = root.querySelector(".this-tab-note") as HTMLElement;
    expect(note.textContent).toContain(
      "Calling a different API from this page",
    );
    const create = note.querySelector("button") as HTMLButtonElement;
    fire(() => create.click());
    expect(onCreateRule).toHaveBeenCalledTimes(1);
  });

  it("removes a row from the session store", async () => {
    await write({ nextNum: 2, tabs: { 5: [override()] } });
    const root = mount({ overrides: [override()] });

    const remove = root.querySelector(".this-tab-remove") as HTMLButtonElement;
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
    const removes = [
      ...root.querySelectorAll(".this-tab-remove"),
    ] as HTMLButtonElement[];
    fire(() => removes[1]?.click());

    const rows = [...root.querySelectorAll(".this-tab-row")];
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(
      rows[2]?.querySelector(".save-as-rule"),
    );
  });
});
