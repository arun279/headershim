// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { Truncate, truncateMiddle } from "./Truncate";

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

  it("measures character width and truncates when no budget is given", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        font: "",
        measureText: () => ({ width: 7 }),
      } as unknown as CanvasRenderingContext2D);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(105);

    const value = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const root = render(<Truncate mode="middle" value={value} />);
    const text = root.querySelector(".truncate")?.textContent;

    // 105px / 7px per char = 15 characters of budget.
    expect(text).toContain("…");
    expect(text?.length).toBe(15);

    getContext.mockRestore();
    clientWidth.mockRestore();
  });
});
