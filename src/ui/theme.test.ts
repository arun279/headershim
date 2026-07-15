// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, THEME_CACHE_KEY } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("applyTheme", () => {
  it("stamps forced themes and mirrors the authoritative choice", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("light");
  });

  it("leaves System to the media query and caches the choice", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    applyTheme("system");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("system");
  });
});
