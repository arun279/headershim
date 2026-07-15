import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy } from "../copy";
import { applyTheme, type Theme } from "../theme";
import {
  closePopover,
  openPositionedPopover,
  trapPopoverFocus,
} from "./popover";
import { usePopoverDismiss } from "./usePopoverDismiss";
import "./ThemeControl.css";

interface ThemeControlProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

const OPTIONS: readonly Theme[] = ["system", "light", "dark"];

export function ThemeControl({ theme, onChange }: ThemeControlProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(theme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [roving, setRoving] = useState(() => OPTIONS.indexOf(theme));

  useEffect(() => {
    setSelected(theme);
    setRoving(OPTIONS.indexOf(theme));
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (media === undefined) return;
    const update = () => setSystemDark(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || menu === null || trigger === null) return;
    openPositionedPopover(menu, trigger, "end");
    optionRefs.current[roving]?.focus();
    return () => closePopover(menu);
  }, [open]);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  };

  usePopoverDismiss(open, menuRef, triggerRef, close);

  const moveTo = (index: number) => {
    const target = (index + OPTIONS.length) % OPTIONS.length;
    setRoving(target);
    optionRefs.current[target]?.focus();
  };

  const select = (next: Theme) => {
    setSelected(next);
    applyTheme(next);
    onChange(next);
    close();
  };

  const dark = selected === "dark" || (selected === "system" && systemDark);
  const labels = copy.options.settings.theme;

  return (
    <div class="theme-control">
      <button
        type="button"
        class="icon-btn"
        aria-label={labels.label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={labels.label}
        ref={triggerRef}
        onClick={() => setOpen((current) => !current)}
      >
        {dark ? <MoonGlyph /> : <SunGlyph />}
      </button>
      {open && (
        <div
          class="menu-pop theme-menu"
          popover="manual"
          role="menu"
          aria-label={labels.label}
          ref={menuRef}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Tab" && menuRef.current !== null) {
              trapPopoverFocus(event, menuRef.current);
              return;
            }
            switch (event.key) {
              case "ArrowDown":
                moveTo(roving + 1);
                break;
              case "ArrowUp":
                moveTo(roving - 1);
                break;
              case "Home":
                moveTo(0);
                break;
              case "End":
                moveTo(OPTIONS.length - 1);
                break;
              case "Escape":
                close();
                break;
              default:
                return;
            }
            event.preventDefault();
          }}
        >
          {OPTIONS.map((option, index) => (
            <button
              key={option}
              type="button"
              class="menu-item theme-option"
              role="menuitemradio"
              aria-checked={selected === option}
              tabIndex={index === roving ? 0 : -1}
              ref={(button) => {
                optionRefs.current[index] = button;
              }}
              onFocus={() => setRoving(index)}
              onClick={() => select(option)}
            >
              <span class="theme-check" aria-hidden="true">
                {selected === option ? "✓" : ""}
              </span>
              {labels.options[option]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SunGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.7" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.05 1.05M11.9 11.9l1.05 1.05M12.95 3.05 11.9 4.1M4.1 11.9l-1.05 1.05" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12.9 10.7A5.7 5.7 0 0 1 5.3 3.1 5.7 5.7 0 1 0 12.9 10.7Z" />
    </svg>
  );
}
