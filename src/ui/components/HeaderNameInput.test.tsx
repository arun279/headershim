// @vitest-environment happy-dom
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import { COMMON_HEADER_NAMES } from "../../core/header-names";
import { LiveRegionProvider } from "../a11y/LiveRegion";
import { copy } from "../copy";
import { copy as editorCopy } from "../copy.editor";
import { fire, press, render, typeInto } from "../test/render";
import { HeaderNameInput } from "./HeaderNameInput";

function Harness({
  direction = "request",
  onBubble,
}: {
  direction?: "request" | "response";
  onBubble?: ((key: string) => void) | undefined;
}) {
  const [value, setValue] = useState("");
  return (
    <LiveRegionProvider>
      {/* Stands in for the editor: records a key only when HeaderNameInput
          left it unprevented, the same signal Sheet's onKeyDown reads. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: test harness stand-in for the editor's onKeyDown listener, not user-facing. */}
      <div
        onKeyDown={(event) => {
          if (!event.defaultPrevented) {
            onBubble?.(event.key);
          }
        }}
      >
        <HeaderNameInput
          value={value}
          direction={direction}
          onInput={setValue}
        />
      </div>
    </LiveRegionProvider>
  );
}

function mount(options: { onBubble?: (key: string) => void } = {}) {
  const root = render(<Harness onBubble={options.onBubble} />);
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

const optionNames = (ctx: ReturnType<typeof mount>) =>
  ctx.options().map((option) => option.querySelector(".mono")?.textContent);

// Prefix matches lead, substring matches follow.
const authMatches = [
  "authorization",
  "proxy-authenticate",
  "proxy-authorization",
  "www-authenticate",
];

/** Mounts with the list open on "auth", recording keys that reach the editor. */
function mountBubbling() {
  const bubbled: string[] = [];
  const ctx = mount({ onBubble: (key) => bubbled.push(key) });
  typeInto(ctx.input(), "auth");
  return { ctx, bubbled };
}

describe("HeaderNameInput combobox contract", () => {
  it("opens filtered by typing, with nothing active, wiring the ARIA contract", () => {
    const ctx = mount();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
    expect(ctx.input().getAttribute("aria-autocomplete")).toBe("list");

    typeInto(ctx.input(), "auth");
    expect(ctx.input().getAttribute("aria-expanded")).toBe("true");
    expect(ctx.input().getAttribute("aria-controls")).toBe(
      ctx.listbox()?.getAttribute("id"),
    );
    expect(ctx.input().hasAttribute("aria-activedescendant")).toBe(false);
    expect(optionNames(ctx)).toEqual(authMatches);
  });

  it("closes the list once the field empties back out", () => {
    const ctx = mount();
    typeInto(ctx.input(), "auth");
    expect(ctx.listbox()).not.toBeNull();

    typeInto(ctx.input(), "");
    expect(ctx.listbox()).toBeNull();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the list closed when the query matches nothing", () => {
    const ctx = mount();
    typeInto(ctx.input(), "not-a-real-header");
    expect(ctx.listbox()).toBeNull();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles the list open and closed from the chevron, filtered or full", () => {
    const ctx = mount();
    typeInto(ctx.input(), "auth");
    expect(ctx.listbox()).not.toBeNull();

    fire(() => ctx.toggle().click());
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
    expect(ctx.listbox()).toBeNull();

    fire(() => ctx.toggle().click());
    expect(ctx.input().getAttribute("aria-expanded")).toBe("true");
    expect(optionNames(ctx)).toEqual(authMatches);
  });

  it("still opens the full list from the chevron on an empty field", () => {
    const ctx = mount();
    fire(() => ctx.toggle().click());
    expect(ctx.input().getAttribute("aria-expanded")).toBe("true");
    expect(ctx.options().length).toBe(COMMON_HEADER_NAMES.length);
  });

  it("still opens on ArrowDown from a closed list, landing on the first option", () => {
    const ctx = mount();
    press(ctx.input(), "ArrowDown");
    expect(ctx.input().getAttribute("aria-expanded")).toBe("true");
    const first = ctx.options()[0] as HTMLElement;
    expect(ctx.input().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.getAttribute("aria-selected")).toBe("true");
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

  it("closes the list and bubbles Enter to the editor when nothing is active", () => {
    const { ctx, bubbled } = mountBubbling();
    expect(ctx.input().hasAttribute("aria-activedescendant")).toBe(false);

    press(ctx.input(), "Enter");

    expect(ctx.input().value).toBe("auth");
    expect(ctx.listbox()).toBeNull();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
    expect(bubbled).toEqual(["Enter"]);
  });

  it("closes the list on Escape before the key reaches the editor", () => {
    const { ctx, bubbled } = mountBubbling();

    press(ctx.input(), "Escape");
    expect(ctx.listbox()).toBeNull();
    expect(ctx.input().value).toBe("auth");
    expect(bubbled).toEqual([]);

    press(ctx.input(), "Escape");
    expect(bubbled).toEqual(["Escape"]);
  });

  it("an option dismissed with Escape is not accepted by a later Enter", () => {
    const { ctx, bubbled } = mountBubbling();
    press(ctx.input(), "ArrowDown");
    press(ctx.input(), "Escape");
    expect(ctx.listbox()).toBeNull();

    press(ctx.input(), "Enter");

    expect(ctx.input().value).toBe("auth");
    expect(bubbled).toEqual(["Enter"]);
  });

  it("a second Enter after accepting a suggestion still reaches the editor", () => {
    const bubbled: string[] = [];
    const ctx = mount({ onBubble: (key) => bubbled.push(key) });
    typeInto(ctx.input(), "www-auth");
    press(ctx.input(), "ArrowDown");
    press(ctx.input(), "Enter");
    expect(ctx.input().value).toBe("www-authenticate");
    expect(ctx.listbox()).toBeNull();

    press(ctx.input(), "Enter");

    expect(bubbled).toEqual(["Enter"]);
  });

  it("closes the suggestion list when focus leaves the field", () => {
    const ctx = mount();
    const next = document.createElement("input");
    ctx.root.appendChild(next);
    fire(() => ctx.input().focus());
    typeInto(ctx.input(), "auth");
    expect(ctx.listbox()).not.toBeNull();

    fire(() => next.focus());

    expect(ctx.listbox()).toBeNull();
    expect(ctx.input().getAttribute("aria-expanded")).toBe("false");
  });

  it("announces the match count politely, singular and plural", () => {
    const ctx = mount();
    typeInto(ctx.input(), "auth");
    expect(ctx.liveRegion().textContent).toBe(editorCopy.editor.suggestions(4));
    typeInto(ctx.input(), "www-auth");
    expect(ctx.liveRegion().textContent).toBe("1 suggestion");
  });

  it("shows the option hint in the mute face", () => {
    const ctx = mount();
    typeInto(ctx.input(), "authorization");
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
    ).toBe(editorCopy.editor.placeholders.headerName.request);

    const response = render(<Harness direction="response" />);
    expect(
      (response.querySelector('[role="combobox"]') as HTMLInputElement)
        .placeholder,
    ).toBe(editorCopy.editor.placeholders.headerName.response);
  });
});
