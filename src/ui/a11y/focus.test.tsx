// @vitest-environment happy-dom
import { useRef } from "preact/hooks";
import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { getFocusable, useFocusTrap } from "./focus";

describe("getFocusable", () => {
  it("collects enabled, tabbable elements in document order", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <a href="#a">a</a>
      <button>b</button>
      <button disabled>disabled</button>
      <input />
      <input disabled />
      <div tabindex="0">d</div>
      <div tabindex="-1">skip</div>
      <span>text</span>`;
    expect(
      getFocusable(root).map((el) => el.textContent?.trim() || el.tagName),
    ).toEqual(["a", "b", "INPUT", "d"]);
  });
});

describe("useFocusTrap", () => {
  function Trapped() {
    const ref = useRef<HTMLDivElement>(null);
    const first = useRef<HTMLButtonElement>(null);
    useFocusTrap(ref, true, { initialFocus: first });
    return (
      <div ref={ref}>
        <button type="button" ref={first}>
          first
        </button>
        <button type="button">last</button>
      </div>
    );
  }

  it("focuses the initial target and wraps Shift+Tab from first to last", () => {
    const root = render(<Trapped />);
    expect(document.activeElement?.textContent).toBe("first");
    const container = root.querySelector("div > div") as HTMLElement;
    root.querySelector<HTMLButtonElement>("button")?.focus();
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement?.textContent).toBe("last");
  });

  it("swallows Tab when the container has nothing focusable", () => {
    function Empty() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, true);
      return <div ref={ref} />;
    }
    const root = render(<Empty />);
    const container = root.querySelector("div > div") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
