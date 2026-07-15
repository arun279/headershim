// @vitest-environment happy-dom
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import type { ResourceGroup } from "../../core/model";
import { copy, sentenceText } from "../copy";
import { fire, focusOut, press, render, typeInto } from "../test/render";
import { type ScopeDraft, ScopeEditor } from "./ScopeEditor";

function Harness({
  initialTypes = "all" as ResourceGroup[] | "all",
  initialScope = {
    type: "domains",
    domains: ["api.example.com"],
    pattern: "",
    regex: "",
  } as ScopeDraft,
}) {
  const [scope, setScope] = useState(initialScope);
  const [types, setTypes] = useState(initialTypes);
  return (
    <ScopeEditor
      scope={scope}
      resourceTypes={types}
      onScope={setScope}
      onResourceTypes={setTypes}
    />
  );
}

function mount(props: Parameters<typeof Harness>[0] = {}) {
  const root = render(<Harness {...props} />);
  return {
    root,
    radios: () =>
      [...root.querySelectorAll(".segments input")] as HTMLInputElement[],
    chipInput: () =>
      root.querySelector(".domain-chip-input") as HTMLInputElement,
    chips: () =>
      [...root.querySelectorAll(".domain-chip .mono")].map(
        (chip) => chip.textContent,
      ),
    micros: () =>
      [...root.querySelectorAll(".editor-micro")].map(
        (micro) => micro.textContent,
      ),
    disclosure: () => root.querySelector(".disclosure") as HTMLButtonElement,
    checkboxes: () =>
      [...root.querySelectorAll(".rt-item input")] as HTMLInputElement[],
  };
}

describe("ScopeEditor match type", () => {
  it("renders the three segments as a native radio group, Domains checked", () => {
    const ctx = mount();
    expect(ctx.root.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(ctx.radios().map((radio) => radio.checked)).toEqual([
      true,
      false,
      false,
    ]);
    // One name group = native arrow-key move-and-select semantics.
    expect(new Set(ctx.radios().map((radio) => radio.name)).size).toBe(1);
  });

  it("switches to URL pattern with the syntax hint and the grant note", () => {
    const ctx = mount();
    fire(() => ctx.radios()[1]?.click());
    expect(ctx.root.querySelector('[aria-label="URL pattern"]')).not.toBeNull();
    expect(ctx.micros().slice(0, 2)).toEqual([
      sentenceText(copy.editor.patternHint),
      copy.editor.grantNote,
    ]);
  });

  it("shows the grant note on regex too", () => {
    const ctx = mount();
    fire(() => ctx.radios()[2]?.click());
    expect(ctx.root.querySelector('[aria-label="Regex"]')).not.toBeNull();
    expect(ctx.micros()).toContain(copy.editor.grantNote);
  });

  it("keeps All sites a subordinate link, not a fourth segment", () => {
    const ctx = mount();
    const link = ctx.root.querySelector(".all-sites") as HTMLButtonElement;
    expect(link.getAttribute("aria-pressed")).toBe("false");
    expect(ctx.radios()).toHaveLength(3);
    fire(() => link.click());
    expect(
      (ctx.root.querySelector(".all-sites") as HTMLElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(ctx.radios().every((radio) => !radio.checked)).toBe(true);
  });
});

describe("ScopeEditor domain chips", () => {
  it("commits a chip on Enter and comma, lowercased and deduplicated", () => {
    const ctx = mount();
    typeInto(ctx.chipInput(), "CDN.Example.com");
    press(ctx.chipInput(), "Enter");
    expect(ctx.chips()).toEqual(["api.example.com", "cdn.example.com"]);
    expect(ctx.chipInput().value).toBe("");

    typeInto(ctx.chipInput(), "api.example.com");
    press(ctx.chipInput(), ",");
    expect(ctx.chips()).toEqual(["api.example.com", "cdn.example.com"]);
  });

  it("shows the Enter hint beside the chip input", () => {
    const ctx = mount();
    const hint = ctx.root.querySelector(".chip-field-hint") as HTMLElement;
    expect(hint.textContent).toBe(copy.editor.addChipHint);
    expect(ctx.chipInput().getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("commits pending text when the field blurs", () => {
    const ctx = mount();
    typeInto(ctx.chipInput(), "cdn.example.com");
    focusOut(ctx.chipInput(), document.body);
    fire(() => ctx.chipInput().dispatchEvent(new FocusEvent("blur")));
    expect(ctx.chips()).toContain("cdn.example.com");
  });

  it("removes the last chip with Backspace on an empty input, any chip via ✕", () => {
    const ctx = mount();
    typeInto(ctx.chipInput(), "cdn.example.com");
    press(ctx.chipInput(), "Enter");
    press(ctx.chipInput(), "Backspace");
    expect(ctx.chips()).toEqual(["api.example.com"]);

    const x = ctx.root.querySelector(".domain-chip-x") as HTMLButtonElement;
    expect(x.getAttribute("aria-label")).toBe(
      copy.editor.removeDomain("api.example.com"),
    );
    fire(() => x.click());
    expect(ctx.chips()).toEqual([]);
  });

  it("carries the subdomain helper line", () => {
    const ctx = mount();
    expect(ctx.micros()).toContain(copy.editor.domainsHelper);
    expect(ctx.micros()).toContain(copy.editor.requestTarget);
  });

  it("moves focus to a surviving chip control when a middle chip is removed", () => {
    const ctx = mount({
      initialScope: {
        type: "domains",
        domains: ["a.example.com", "b.example.com", "c.example.com"],
        pattern: "",
        regex: "",
      },
    });
    const xs = [
      ...ctx.root.querySelectorAll(".domain-chip-x"),
    ] as HTMLButtonElement[];
    fire(() => xs[1]?.click());

    expect(ctx.chips()).toEqual(["a.example.com", "c.example.com"]);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      copy.editor.removeDomain("c.example.com"),
    );
  });
});

describe("ScopeEditor resource types", () => {
  it("defaults to All types and says top-level pages are included", () => {
    const ctx = mount();
    expect(ctx.disclosure().textContent).toContain(copy.editor.allTypes);
    expect(ctx.micros()).toContain(copy.editor.includesPages);
  });

  it("opens a checkbox group of the ten groupings, all checked by default", () => {
    const ctx = mount();
    fire(() => ctx.disclosure().click());
    expect(ctx.disclosure().getAttribute("aria-expanded")).toBe("true");
    const boxes = ctx.checkboxes();
    expect(boxes).toHaveLength(10);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });

  it("drops the pages helper when Pages is unchecked and counts the rest", () => {
    const ctx = mount();
    fire(() => ctx.disclosure().click());
    fire(() => ctx.checkboxes()[0]?.click());
    expect(ctx.micros()).not.toContain(copy.editor.includesPages);
    expect(ctx.disclosure().textContent).toContain(copy.resourceTypes.count(9));
  });

  it("names one or two selected groups outright", () => {
    const ctx = mount({ initialTypes: ["subframes", "xhr"] });
    expect(ctx.disclosure().textContent).toContain("Subframes, XHR/fetch");
  });

  it("returns to All types when the last grouping is re-checked", () => {
    const ctx = mount({
      initialTypes: [
        "pages",
        "subframes",
        "xhr",
        "scripts",
        "stylesheets",
        "images",
        "fonts",
        "media",
        "websockets",
      ],
    });
    fire(() => ctx.disclosure().click());
    const other = ctx.checkboxes().at(-1) as HTMLInputElement;
    expect(other.checked).toBe(false);
    fire(() => other.click());
    expect(ctx.disclosure().textContent).toContain(copy.editor.allTypes);
  });
});
