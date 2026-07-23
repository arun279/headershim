// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import {
  Truncate,
  truncateEnd,
  truncateMiddle,
  truncateWords,
} from "./Truncate";

describe("truncateMiddle", () => {
  it("keeps both ends and cuts the middle", () => {
    const value = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6J9.sflKxwRJSMeK";
    const out = truncateMiddle(value, 24);
    expect(out).toContain("…");
    expect(out.startsWith("Bearer ")).toBe(true);
    expect(value.endsWith(out.slice(out.indexOf("…") + 1))).toBe(true);
    expect(out.length).toBeLessThanOrEqual(24);
  });

  it("favours the head so the leading label survives", () => {
    // budget 23 → head 12, tail 11
    expect(truncateMiddle("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", 24)).toBe(
      "0123456789AB…PQRSTUVWXYZ",
    );
  });

  it("returns short strings untouched", () => {
    expect(truncateMiddle("short", 24)).toBe("short");
    expect(truncateMiddle("exactfit", 8)).toBe("exactfit");
  });

  it("degrades to head + ellipsis when there is no room for a tail", () => {
    expect(truncateMiddle("abcdef", 2)).toBe("a…");
  });

  it("does nothing when the budget cannot hold an ellipsis", () => {
    expect(truncateMiddle("abcdef", 1)).toBe("abcdef");
  });
});

describe("Truncate end mode", () => {
  it("renders one titled span that keeps the full string for AT and clips via CSS", () => {
    const value = "x-corp-internal-request-tracing-identifier";
    const root = render(<Truncate value={value} class="rule-name" />);
    const spans = root.querySelectorAll("span");
    expect(spans).toHaveLength(1);
    const span = spans[0] as HTMLSpanElement;
    // The full string stays in the DOM (ellipsis is presentational only) and the
    // pointer readout is carried in title.
    expect(span.textContent).toBe(value);
    expect(span.getAttribute("title")).toBe(value);
    // The shared class carries the one-line + min-width:0 + ellipsis discipline.
    expect(span.classList.contains("truncate")).toBe(true);
    expect(span.classList.contains("truncate-end")).toBe(true);
    expect(span.classList.contains("rule-name")).toBe(true);
  });

  it("defaults to end mode when none is given", () => {
    const root = render(<Truncate value="Profile" />);
    expect(
      (root.querySelector("span") as HTMLSpanElement).classList.contains(
        "truncate-end",
      ),
    ).toBe(true);
  });

  it("uses a trailing ellipsis at the shared character ceiling", () => {
    expect(truncateEnd("api.very-long-staging.example.com", 20)).toBe(
      "api.very-long-stagi…",
    );
    const root = render(
      <Truncate
        mode="end"
        value="api.very-long-staging.example.com"
        maxChars={20}
      />,
    );
    expect(root.querySelector("span")?.textContent).toBe(
      "api.very-long-stagi…",
    );
  });
});

describe("Truncate word mode", () => {
  it("cuts a multiword profile name at a word boundary", () => {
    expect(truncateWords("Staging environment overrides", 22)).toBe(
      "Staging environment…",
    );
    const root = render(
      <Truncate
        mode="word"
        value="Staging environment overrides"
        maxChars={22}
      />,
    );
    expect(root.querySelector("span")?.textContent).toBe(
      "Staging environment…",
    );
  });
});

describe("Truncate middle mode", () => {
  it("carries the full value in title and shows a middle-cut display", () => {
    const value = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6J9.sflKx";
    const root = render(
      <Truncate mode="middle" value={value} maxChars={20} class="rule-value" />,
    );
    const spans = root.querySelectorAll("span");
    // One node only: the deleted focus-reveal never reintroduces a hidden clone.
    expect(spans).toHaveLength(1);
    const span = spans[0] as HTMLSpanElement;
    expect(span.getAttribute("title")).toBe(value);
    expect(span.textContent).toContain("…");
    expect(span.textContent?.length).toBeLessThanOrEqual(20);
    expect(span.classList.contains("truncate")).toBe(true);
    // No end-mode ellipsis in middle mode: the string is split by hand.
    expect(span.classList.contains("truncate-end")).toBe(false);
  });

  it("shows the whole value when it fits the budget", () => {
    const root = render(<Truncate mode="middle" value="short" maxChars={20} />);
    expect((root.querySelector("span") as HTMLSpanElement).textContent).toBe(
      "short",
    );
  });

  // A canvas whose glyphs are 7px wide, except the fullwidth ones at 14px, which
  // is roughly the ratio a real font gives them. Measuring a stand-in character
  // instead of the string is what hands a Japanese value twice the room it has.
  const WIDE = /[　-ヿ一-鿿]/u;
  function mockCanvas(columnWidth: number) {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        font: "",
        measureText: (text: string) => ({
          width: [...text].reduce(
            (total, character) => total + (WIDE.test(character) ? 14 : 7),
            0,
          ),
        }),
      } as unknown as CanvasRenderingContext2D);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(columnWidth);
    return () => {
      getContext.mockRestore();
      clientWidth.mockRestore();
    };
  }

  it("fits the rendered string to the column when no budget is given", () => {
    const restore = mockCanvas(105);

    const value = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const root = render(<Truncate mode="middle" value={value} />);
    const text = root.querySelector(".truncate")?.textContent;

    // 105px of column, 7px a glyph: 15 of them.
    expect(text).toContain("…");
    expect(text?.length).toBe(15);

    restore();
  });

  it("gives a fullwidth value the room it takes, not the room a Latin one takes", () => {
    const restore = mockCanvas(105);

    const root = render(
      <Truncate mode="middle" value="山田太郎テスト環境ユーザー名" />,
    );
    const text = root.querySelector(".truncate")?.textContent;

    // Half the glyph count of the Latin case, and marked rather than clipped.
    expect(text).toContain("…");
    expect(text?.length).toBe(8);

    restore();
  });
});
