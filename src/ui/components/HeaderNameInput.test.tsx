// @vitest-environment happy-dom
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import { LiveRegionProvider } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { fire, press, render, typeInto } from "../test/render";
import { HeaderNameInput } from "./HeaderNameInput";

function Harness({
  direction = "request",
}: {
  direction?: "request" | "response";
}) {
  const [value, setValue] = useState("");
  return (
    <LiveRegionProvider>
      <HeaderNameInput value={value} direction={direction} onInput={setValue} />
    </LiveRegionProvider>
  );
}

function mount() {
  const root = render(<Harness />);
  return {
    root,
    input: () => root.querySelector('[role="combobox"]') as HTMLInputElement,
    toggle: () => root.querySelector(".combo-toggle") as HTMLButtonElement,
    listbox: () => root.querySelector('[role="listbox"]'),
    options: () => [...root.querySelectorAll('[role="option"]')],
    liveRegion: () =>
      document.querySelector('[aria-live="polite"]') as HTMLElement,
  };
}

describe("HeaderNameInput combobox contract", () => {
  it("stays shut while typing and opens on the chevron, wiring the ARIA contract", () => {
    const ctx = mount();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
    expect(ctx.input().getAttribute("aria-autocomplete")).toBe("list");

    // The defect: the list opened on every keystroke and painted over the value
    // field below, so a click meant for the value selected a suggestion instead.
    typeInto(ctx.input(), "auth");
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
    expect(ctx.listbox()).toBeNull();

    fire(() => ctx.toggle().click());
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

  it("closes the suggestion list when focus leaves the field", () => {
    const ctx = mount();
    const next = document.createElement("input");
    ctx.root.appendChild(next);
    fire(() => ctx.input().focus());
    typeInto(ctx.input(), "auth");
    fire(() => ctx.toggle().click());
    expect(ctx.listbox()).not.toBeNull();

    fire(() => next.focus());

    expect(ctx.listbox()).toBeNull();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
  });

  it("announces the match count politely, singular and plural", () => {
    const ctx = mount();
    typeInto(ctx.input(), "auth");
    fire(() => ctx.toggle().click());
    expect(ctx.liveRegion().textContent).toBe(copy.editor.suggestions(4));
    typeInto(ctx.input(), "www-auth");
    expect(ctx.liveRegion().textContent).toBe("1 suggestion");
  });

  it("shows the option hint in the mute face", () => {
    const ctx = mount();
    typeInto(ctx.input(), "authorization");
    fire(() => ctx.toggle().click());
    expect(ctx.options()[0]?.textContent).toBe("authorization: credentials");
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

  it("replaces the case line with the refusal when the name is illegal", () => {
    const ctx = mount();
    // "saved as x bad header" once reassured about a name the save then refused;
    // the field now shows that refusal in the case line's place, not both.
    typeInto(ctx.input(), "X Bad Header");
    expect(ctx.root.querySelector(".editor-micro")).toBeNull();
    expect(ctx.root.querySelector(".editor-error")?.textContent).toBe(
      copy.errors.headerNameInvalid,
    );
    expect(ctx.input().getAttribute("aria-invalid")).toBe("true");
  });

  it("names an HTTP/2 pseudo-header as unmodifiable, not merely illegal", () => {
    const ctx = mount();
    typeInto(ctx.input(), ":authority");
    expect(ctx.root.querySelector(".editor-error")?.textContent).toBe(
      copy.errors.headerNotModifiable,
    );
  });

  // The example must belong to the direction: a request header on the request
  // side, a response header on the response side, never one constant the wrong
  // side can't carry.
  it("shows a direction-appropriate placeholder example", () => {
    const request = render(<Harness direction="request" />);
    expect(
      (request.querySelector('[role="combobox"]') as HTMLInputElement)
        .placeholder,
    ).toBe(copy.editor.placeholders.headerName.request);

    const response = render(<Harness direction="response" />);
    expect(
      (response.querySelector('[role="combobox"]') as HTMLInputElement)
        .placeholder,
    ).toBe(copy.editor.placeholders.headerName.response);
  });
});
