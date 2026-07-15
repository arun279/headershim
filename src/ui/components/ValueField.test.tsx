// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { copy } from "../copy";
import { fire, press, render } from "../test/render";
import { ValueField } from "./ValueField";

function mount(props: Partial<Parameters<typeof ValueField>[0]> = {}) {
  const onInput = vi.fn();
  const onGenerate = vi.fn();
  const root = render(
    <ValueField
      value="v1"
      onInput={onInput}
      onGenerate={onGenerate}
      {...props}
    />,
  );
  return {
    root,
    onInput,
    onGenerate,
    insertButton: () => root.querySelector(".insert-btn") as HTMLButtonElement,
    menuItems: () =>
      [...root.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[],
    input: () => root.querySelector("textarea") as HTMLTextAreaElement,
  };
}

describe("ValueField insert menu", () => {
  it("offers exactly UUID and Timestamp as generated values", () => {
    const ctx = mount();
    expect(ctx.insertButton().getAttribute("aria-haspopup")).toBe("menu");
    fire(() => ctx.insertButton().click());
    expect(ctx.menuItems().map((item) => item.textContent)).toEqual([
      copy.editor.insertUuid,
      copy.editor.insertTimestamp,
    ]);
    expect(document.activeElement).toBe(ctx.menuItems()[0]);
  });

  it("reports the picked kind and closes, returning focus to the trigger", () => {
    const ctx = mount();
    fire(() => ctx.insertButton().click());
    fire(() => ctx.menuItems()[1]?.click());
    expect(ctx.onGenerate).toHaveBeenCalledExactlyOnceWith("timestamp");
    expect(ctx.menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(ctx.insertButton());
  });

  it("closes on Esc without collapsing the editor around it", () => {
    const ctx = mount();
    fire(() => ctx.insertButton().click());
    const item = ctx.menuItems()[0] as HTMLButtonElement;
    press(item, "Escape");
    expect(ctx.menuItems()).toHaveLength(0);
  });
});

describe("ValueField multiline control", () => {
  it("uses a soft-wrapping, vertically resizable textarea", () => {
    const ctx = mount({ value: "x".repeat(320) });
    expect(ctx.input().getAttribute("wrap")).toBe("soft");
    expect(ctx.input().value).toHaveLength(320);
  });

  it("strips pasted line breaks and shows the wire-format note", () => {
    const ctx = mount({ value: "before after" });
    fire(() => {
      ctx.input().setSelectionRange(7, 7);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: () => "one\ntwo" },
      });
      ctx.input().dispatchEvent(event);
    });
    expect(ctx.onInput).toHaveBeenCalledWith("before one twoafter");
    expect(ctx.root.textContent).toContain(copy.editor.newlineRemoved);
  });
});

describe("ValueField generated notes", () => {
  it("says nothing when the value is plain text", () => {
    const ctx = mount();
    expect(ctx.root.textContent).not.toContain(copy.generatedValue.note);
  });

  it("labels an unsaved generated value with the frozen explanation", () => {
    const ctx = mount({
      generated: { kind: "uuid", at: "2026-07-12T14:03:00.000Z" },
    });
    expect(ctx.root.textContent).toContain(copy.generatedValue.note);
  });

  it("shows the freeze time once saved and regenerates the same kind", () => {
    const ctx = mount({
      generated: { kind: "timestamp", at: "2026-07-12T14:03:00.000Z" },
      frozenAt: "2026-07-12 14:03 UTC",
    });
    expect(ctx.root.textContent).toContain(
      copy.generatedValue.frozen("2026-07-12 14:03 UTC"),
    );
    const regenerate = [...ctx.root.querySelectorAll("button")].find(
      (button) => button.textContent === copy.actions.regenerate,
    ) as HTMLButtonElement;
    fire(() => regenerate.click());
    expect(ctx.onGenerate).toHaveBeenCalledExactlyOnceWith("timestamp");
  });
});
