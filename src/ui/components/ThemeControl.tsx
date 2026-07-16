import { useEffect, useState } from "preact/hooks";
import { copy } from "../copy";
import { applyTheme, type Theme } from "../theme";
import "./ThemeControl.css";

interface ThemeControlProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

/**
 * The popup has one immediate theme action. System/Light/Dark remains a
 * labeled setting in options; this button simply flips the rendered theme and
 * records the resulting explicit Light or Dark choice.
 */
export function ThemeControl({ theme, onChange }: ThemeControlProps) {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (media === undefined) return;
    const update = () => setSystemDark(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const dark = theme === "dark" || (theme === "system" && systemDark);
  const next: Theme = dark ? "light" : "dark";
  const label = dark
    ? copy.options.settings.theme.switchToLight
    : copy.options.settings.theme.switchToDark;

  return (
    <button
      type="button"
      class="icon-btn theme-toggle"
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={() => {
        applyTheme(next);
        onChange(next);
      }}
    >
      {dark ? <SunGlyph /> : <MoonGlyph />}
    </button>
  );
}

function SunGlyph() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="8.5" cy="8.5" r="2.7" />
      <path d="M8.5 1v1.5m0 12V16M1 8.5h1.5m12 0H16M3.2 3.2l1.1 1.1m8.4 8.4 1.1 1.1m0-10.6-1.1 1.1m-8.4 8.4-1.1 1.1" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M13.4 9.2A5.6 5.6 0 0 1 6.8 2.6a5.6 5.6 0 1 0 6.6 6.6Z" />
    </svg>
  );
}
