// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { copy as editorCopy } from "../copy.editor";
import { fire, pasteInto, press, render } from "../test/render";
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
    generateButton: () =>
      root.querySelector(".generate-btn") as HTMLButtonElement,
    menuItems: () =>
      [...root.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[],
    input: () => root.querySelector("textarea") as HTMLTextAreaElement,
  };
}

describe("ValueField generate menu", () => {
  it("offers exactly UUID and Timestamp as generated values", () => {
    const ctx = mount();
    expect(ctx.generateButton().getAttribute("aria-haspopup")).toBe("menu");
    fire(() => ctx.generateButton().click());
    expect(ctx.menuItems().map((item) => item.textContent)).toEqual([
      editorCopy.editor.generateUuid,
      editorCopy.editor.generateTimestamp,
    ]);
    expect(document.activeElement).toBe(ctx.menuItems()[0]);
  });

  it("reports the picked kind and closes, returning focus to the trigger", () => {
    const ctx = mount();
    fire(() => ctx.generateButton().click());
    fire(() => ctx.menuItems()[1]?.click());
    expect(ctx.onGenerate).toHaveBeenCalledExactlyOnceWith("timestamp");
    expect(ctx.menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(ctx.generateButton());
  });

  it("closes on Esc without collapsing the editor around it", () => {
    const ctx = mount();
    fire(() => ctx.generateButton().click());
    const item = ctx.menuItems()[0] as HTMLButtonElement;
    press(item, "Escape");
    expect(ctx.menuItems()).toHaveLength(0);
  });

  it("cycles Tab from the last item without closing the menu", () => {
    const ctx = mount();
    fire(() => ctx.generateButton().click());
    const items = ctx.menuItems();
    const last = items.at(-1);
    if (last === undefined) throw new Error("Expected generate menu items");
    last.focus();
    press(last, "Tab");
    expect(document.activeElement).toBe(items[0]);
    expect(ctx.menuItems()).toHaveLength(2);
  });
});

describe("ValueField multiline control", () => {
  it("holds a long value whole in a soft-wrapping textarea", () => {
    const ctx = mount({ value: "x".repeat(320) });
    expect(ctx.input().getAttribute("wrap")).toBe("soft");
    expect(ctx.input().value).toHaveLength(320);
  });

  it("strips pasted line breaks and shows the wire-format note", () => {
    const ctx = mount({ value: "before after" });
    fire(() => ctx.input().setSelectionRange(7, 7));
    pasteInto(ctx.input(), "one\ntwo");
    expect(ctx.onInput).toHaveBeenCalledWith("before one twoafter");
    expect(ctx.root.textContent).toContain(editorCopy.editor.newlineRemoved);
  });

  // What a copied token actually carries. Trailing whitespace is the
  // clipboard's, not the user's, and a stray space silently breaks the header.
  it("trims a pasted token rather than keeping the clipboard's whitespace", () => {
    const ctx = mount({ value: "" });
    pasteInto(ctx.input(), "Bearer eyJhbGciOi.J9\n");
    expect(ctx.onInput).toHaveBeenCalledWith("Bearer eyJhbGciOi.J9");
    expect(ctx.root.textContent).not.toContain(
      editorCopy.editor.newlineRemoved,
    );
  });

  it("clears the line-break note after clean input", () => {
    const ctx = mount({ value: "before after" });
    fire(() => ctx.input().setSelectionRange(7, 7));
    pasteInto(ctx.input(), "one\ntwo");
    expect(ctx.root.textContent).toContain(editorCopy.editor.newlineRemoved);

    fire(() => {
      ctx.input().value = "clean";
      ctx.input().dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(ctx.root.textContent).not.toContain(
      editorCopy.editor.newlineRemoved,
    );
  });
});

describe("ValueField standing note", () => {
  it("says a plain value is used exactly as typed, not as a template", () => {
    const ctx = mount();
    expect(ctx.root.textContent).toContain(editorCopy.valueNote.literal);
  });

  it("replaces the literal note with the freeze time and regenerates the kind", () => {
    const ctx = mount({
      generated: { kind: "timestamp", at: "2026-07-12T14:03:00.000Z" },
    });
    expect(ctx.root.textContent).not.toContain(editorCopy.valueNote.literal);
    expect(ctx.root.textContent).toContain(
      editorCopy.valueNote.frozen("2026-07-12T14:03:00.000Z"),
    );
    const regenerate = [...ctx.root.querySelectorAll("button")].find(
      (button) => button.textContent === editorCopy.actions.regenerate,
    ) as HTMLButtonElement;
    fire(() => regenerate.click());
    expect(ctx.onGenerate).toHaveBeenCalledExactlyOnceWith("timestamp");
  });
});
