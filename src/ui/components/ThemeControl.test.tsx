// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fire, press, render } from "../test/render";
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
