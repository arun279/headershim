import type { Settings } from "../core/model";

export type Theme = Settings["theme"];

export const THEME_CACHE_KEY = "headershim.theme";

/** Applies the theme immediately and keeps a synchronous pre-paint cache. */
export function applyTheme(theme: Theme): void {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }

  try {
    localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // Storage can be unavailable in a restricted test or browsing context;
    // the authoritative extension store still controls the rendered theme.
  }
}
