// @vitest-environment happy-dom
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import { LiveRegionProvider } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { press, render, typeInto } from "../test/render";
import { HeaderNameInput } from "./HeaderNameInput";

function Harness({
  operation = "set",
}: {
  operation?: "set" | "append" | "remove";
}) {
  const [value, setValue] = useState("");
  return (
    <LiveRegionProvider>
      <HeaderNameInput value={value} operation={operation} onInput={setValue} />
    </LiveRegionProvider>
  );
}

function mount(operation: "set" | "append" | "remove" = "set") {
  const root = render(<Harness operation={operation} />);
  return {
    root,
    input: () => root.querySelector('[role="combobox"]') as HTMLInputElement,
    listbox: () => root.querySelector('[role="listbox"]'),
    options: () => [...root.querySelectorAll('[role="option"]')],
    liveRegion: () =>
      document.querySelector('[aria-live="polite"]') as HTMLElement,
  };
}

describe("HeaderNameInput combobox contract", () => {
  it("wires the full ARIA contract: expanded, controls, options", () => {
    const ctx = mount();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
    expect(ctx.input().getAttribute("aria-autocomplete")).toBe("list");

    typeInto(ctx.input(), "auth");
    expect(ctx.input().getAttribute("aria-expanded")).toBe("true");
    expect(ctx.input().getAttribute("aria-controls")).toBe(
      ctx.listbox()?.getAttribute("id"),
    );
    const names = ctx
      .options()
      .map((option) => option.querySelector(".mono")?.textContent);
    // Prefix matches lead, substring matches follow.
    expect(names).toEqual([
      "authorization",
      "proxy-authenticate",
      "proxy-authorization",
      "www-authenticate",
    ]);
  });

  it("moves aria-activedescendant with the arrows, wrapping both ways", () => {
    const ctx = mount();
    typeInto(ctx.input(), "auth");
    press(ctx.input(), "ArrowDown");
    const first = ctx.options()[0] as HTMLElement;
    expect(ctx.input().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.getAttribute("aria-selected")).toBe("true");

    press(ctx.input(), "ArrowUp");
    const last = ctx.options().at(-1) as HTMLElement;
    expect(ctx.input().getAttribute("aria-activedescendant")).toBe(last.id);
  });

  it("accepts the active option with Enter and closes the list", () => {
    const ctx = mount();
    typeInto(ctx.input(), "auth");
    // Until the user arrows in, nothing is active: Enter would commit "auth"
    // as typed rather than hijack it into a suggestion.
    expect(ctx.input().hasAttribute("aria-activedescendant")).toBe(false);
    press(ctx.input(), "ArrowDown");
    press(ctx.input(), "Enter");
    expect(ctx.input().value).toBe("authorization");
    expect(ctx.listbox()).toBeNull();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
  });

  it("announces the match count politely, singular and plural", () => {
    const ctx = mount();
    typeInto(ctx.input(), "auth");
    expect(ctx.liveRegion().textContent).toBe(copy.editor.suggestions(4));
    typeInto(ctx.input(), "www-auth");
    expect(ctx.liveRegion().textContent).toBe("1 suggestion");
  });

  it("shows the option hint in the mute face", () => {
    const ctx = mount();
    typeInto(ctx.input(), "authorization");
    expect(ctx.options()[0]?.textContent).toBe("authorization— credentials");
  });

  it("shows the case-honesty microline only when the typed case differs", () => {
    const ctx = mount();
    typeInto(ctx.input(), "X-Feature-Override");
    expect(ctx.root.querySelector(".editor-micro")?.textContent).toBe(
      "saved as x-feature-override",
    );
    typeInto(ctx.input(), "x-feature-override");
    expect(ctx.root.querySelector(".editor-micro")).toBeNull();
  });

  it("raises the advisories the moment the name matches", () => {
    const ctx = mount();
    typeInto(ctx.input(), "host");
    expect(ctx.root.querySelector(".editor-advisory")?.textContent).toBe(
      copy.advisories.host,
    );
    typeInto(ctx.input(), "Content-Length");
    expect(ctx.root.querySelector(".editor-advisory")?.textContent).toBe(
      copy.advisories.managedHeader,
    );
    // The advisory participates in the field's accessible description.
    const advisoryId = ctx.root.querySelector(".editor-advisory")?.id;
    expect(ctx.input().getAttribute("aria-describedby")).toContain(advisoryId);
  });
});
