// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { MiddleTruncate, truncateMiddle } from "./MiddleTruncate";

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

describe("MiddleTruncate", () => {
  it("carries the full value in title and truncates the display", () => {
    const value = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6J9.sflKx";
    const root = render(<MiddleTruncate value={value} maxChars={20} />);
    const span = root.querySelector("span") as HTMLSpanElement;
    expect(span.getAttribute("title")).toBe(value);
    // The visible clip is truncated; the row-revealed full node carries the
    // whole value for the keyboard-focus readout (DESIGN §1.2).
    const clip = span.querySelector(".mt-clip");
    expect(clip?.textContent).toContain("…");
    expect(clip?.textContent?.length).toBeLessThanOrEqual(20);
    expect(span.querySelector(".mt-full")?.textContent).toBe(value);
  });

  it("shows the whole value when it fits the budget", () => {
    const root = render(<MiddleTruncate value="short" maxChars={20} />);
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
    const root = render(<MiddleTruncate value={value} />);
    const text = root.querySelector(".mt-clip")?.textContent;

    // 105px / 7px per char = 15 characters of budget.
    expect(text).toContain("…");
    expect(text?.length).toBe(15);

    getContext.mockRestore();
    clientWidth.mockRestore();
  });
});
