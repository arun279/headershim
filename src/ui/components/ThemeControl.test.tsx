// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fire, pointerDown, press, render } from "../test/render";
import { THEME_CACHE_KEY } from "../theme";
import { ThemeControl } from "./ThemeControl";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeControl", () => {
  it("opens a labeled three-choice top-layer menu", () => {
    const root = render(<ThemeControl theme="system" onChange={() => {}} />);
    const trigger = root.querySelector(
      '[aria-label="Theme"]',
    ) as HTMLButtonElement;
    expect(trigger.title).toBe("Theme");
    fire(() => trigger.click());

    const menu = root.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.getAttribute("popover")).toBe("manual");
    expect(
      [...menu.querySelectorAll('[role="menuitemradio"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["✓System", "Light", "Dark"]);
    expect(document.activeElement).toBe(
      menu.querySelector('[role="menuitemradio"]'),
    );
  });

  it("roves menu focus with arrows, Home, and End", () => {
    const root = render(<ThemeControl theme="system" onChange={() => {}} />);
    fire(() =>
      (root.querySelector('[aria-label="Theme"]') as HTMLButtonElement).click(),
    );
    const options = [
      ...root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ];

    expect(options.map((option) => option.tabIndex)).toEqual([0, -1, -1]);
    press(options[0] as HTMLButtonElement, "ArrowUp");
    expect(document.activeElement).toBe(options[2]);
    expect(options.map((option) => option.tabIndex)).toEqual([-1, -1, 0]);

    press(options[2] as HTMLButtonElement, "Home");
    expect(document.activeElement).toBe(options[0]);
    press(options[0] as HTMLButtonElement, "End");
    expect(document.activeElement).toBe(options[2]);
    press(options[2] as HTMLButtonElement, "ArrowDown");
    expect(document.activeElement).toBe(options[0]);
  });

  it("light-dismisses outside and restores focus on a global Escape", async () => {
    const root = render(<ThemeControl theme="system" onChange={() => {}} />);
    const trigger = root.querySelector(
      '[aria-label="Theme"]',
    ) as HTMLButtonElement;
    const outside = document.createElement("button");
    root.appendChild(outside);

    fire(() => trigger.click());
    pointerDown(outside);
    fire(() => outside.focus());
    await Promise.resolve();
    expect(root.querySelector(".theme-menu")).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fire(() => trigger.click());
    fire(() => outside.focus());
    press(outside, "Escape");
    await Promise.resolve();
    expect(root.querySelector(".theme-menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("stamps and mirrors a choice immediately, then returns focus", async () => {
    const onChange = vi.fn();
    const root = render(<ThemeControl theme="system" onChange={onChange} />);
    const trigger = root.querySelector(
      '[aria-label="Theme"]',
    ) as HTMLButtonElement;
    fire(() => trigger.click());
    const dark = [
      ...root.querySelectorAll<HTMLButtonElement>(".theme-option"),
    ].find((button) =>
      button.textContent?.includes("Dark"),
    ) as HTMLButtonElement;
    fire(() => dark.click());
    await Promise.resolve();

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("dark");
    expect(onChange).toHaveBeenCalledWith("dark");
    expect(root.querySelector(".theme-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("System removes the stamp and Escape closes without changing", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const onChange = vi.fn();
    const root = render(<ThemeControl theme="dark" onChange={onChange} />);
    const trigger = root.querySelector(
      '[aria-label="Theme"]',
    ) as HTMLButtonElement;
    fire(() => trigger.click());
    press(root.querySelector(".theme-menu") as HTMLElement, "Escape");
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    fire(() => trigger.click());
    const system = root.querySelector(".theme-option") as HTMLButtonElement;
    fire(() => system.click());
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("system");
  });
});
