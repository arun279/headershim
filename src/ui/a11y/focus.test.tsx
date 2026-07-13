// @vitest-environment happy-dom
import { useRef } from "preact/hooks";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../test/render";
import { focusOnRemoval, getFocusable, useFocusTrap } from "./focus";

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

describe("focusOnRemoval", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function anchor(html: string, ariaLabel: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    return host.querySelector(`[aria-label="${ariaLabel}"]`) as HTMLElement;
  }

  const label = () => document.activeElement?.getAttribute("aria-label");

  it("hands focus to the next chip's control when a middle chip goes", () => {
    focusOnRemoval(
      anchor(
        `<div class="domain-chips">
          <span class="domain-chip"><button aria-label="a">x</button></span>
          <span class="domain-chip"><button aria-label="b">x</button></span>
          <input aria-label="add" />
        </div>`,
        "a",
      ),
    );
    expect(label()).toBe("b");
  });

  it("falls back to the group input when the last chip goes", () => {
    focusOnRemoval(
      anchor(
        `<div class="grant-chips">
          <span class="grant-chip"><button aria-label="a">x</button></span>
          <input aria-label="add" />
        </div>`,
        "a",
      ),
    );
    expect(label()).toBe("add");
  });

  it("lands on the enclosing landmark when the whole group unmounts", () => {
    focusOnRemoval(
      anchor(
        `<main tabindex="-1">
          <ul class="this-tab-rows">
            <li><button aria-label="only">x</button></li>
          </ul>
        </main>`,
        "only",
      ),
    );
    expect(document.activeElement?.tagName).toBe("MAIN");
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
