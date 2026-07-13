import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

interface FocusTrapOptions {
  initialFocus?: RefObject<HTMLElement | null> | undefined;
}

/**
 * Confines Tab/Shift+Tab to `containerRef` while `active`, moves focus inside on
 * activation, and returns it to the previously focused element on deactivation.
 * Layers (modal, verify, editor) share this so focus never escapes an open layer.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  { initialFocus }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || container === null) return;

    const previouslyFocused = container.ownerDocument
      .activeElement as HTMLElement | null;

    (initialFocus?.current ?? getFocusable(container)[0] ?? container).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const activeEl = container.ownerDocument.activeElement;
      if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef, initialFocus]);
}
