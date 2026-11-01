// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { Truncate, truncateEnd, truncateMiddle } from "./Truncate";

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
    expect(span.classList.contains("rule-name")).toBe(true);
  });

  it("defaults to end mode when none is given", () => {
    const root = render(<Truncate value="ABCDEFGHIJ" maxChars={5} />);
    expect(root.querySelector("span")?.textContent).toBe("ABCD…");
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
  });

  it("shows the whole value when it fits the budget", () => {
    const root = render(<Truncate mode="middle" value="short" maxChars={20} />);
    expect((root.querySelector("span") as HTMLSpanElement).textContent).toBe(
      "short",
    );
  });
});
