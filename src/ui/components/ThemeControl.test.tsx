// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../copy";
import { fire, render } from "../test/render";
import { THEME_CACHE_KEY } from "../theme";
import { ThemeControl } from "./ThemeControl";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeControl", () => {
  it("offers one immediate dark-theme action from a light popup", () => {
    const onChange = vi.fn();
    const root = render(<ThemeControl theme="light" onChange={onChange} />);
    const trigger = root.querySelector(".theme-toggle") as HTMLButtonElement;

    expect(trigger.getAttribute("aria-label")).toBe(
      copy.options.settings.theme.switchToDark,
    );
    expect(trigger.title).toBe(copy.options.settings.theme.switchToDark);
    expect(trigger.getAttribute("aria-haspopup")).toBeNull();
    expect(root.querySelector('[role="menu"]')).toBeNull();

    fire(() => trigger.click());

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("dark");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("dark");
  });

  it("offers the inverse action from a dark popup", () => {
    const onChange = vi.fn();
    const root = render(<ThemeControl theme="dark" onChange={onChange} />);
    const trigger = root.querySelector(".theme-toggle") as HTMLButtonElement;

    expect(trigger.getAttribute("aria-label")).toBe(
      copy.options.settings.theme.switchToLight,
    );
    expect(trigger.getAttribute("aria-pressed")).toBe("true");

    fire(() => trigger.click());

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("light");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("light");
  });

  it("resolves System to the rendered theme before choosing the inverse", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(
      () =>
        ({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    try {
      const onChange = vi.fn();
      const root = render(<ThemeControl theme="system" onChange={onChange} />);
      const trigger = root.querySelector(".theme-toggle") as HTMLButtonElement;
      expect(trigger.getAttribute("aria-label")).toBe(
        copy.options.settings.theme.switchToLight,
      );

      fire(() => trigger.click());
      expect(onChange).toHaveBeenCalledExactlyOnceWith("light");
    } finally {
      window.matchMedia = original;
    }
  });
});
