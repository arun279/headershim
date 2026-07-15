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

const REMOVAL_GROUP = ".this-tab-rows, .domain-chips, .grant-chips";
const REMOVAL_ITEM = "li, .domain-chip, .grant-chip";

/**
 * Move focus off a chip/row control that is about to unmount to a still-present
 * neighbor, so removal never drops focus to <body> (WCAG 2.4.3). Prefers the
 * next focusable in the same group, then the last one remaining, then the
 * enclosing landmark when the whole group vanishes.
 */
export function focusOnRemoval(anchor: HTMLElement): void {
  const group = anchor.closest<HTMLElement>(REMOVAL_GROUP);
  const item = anchor.closest(REMOVAL_ITEM);
  if (group === null || item === null) {
    anchor.closest<HTMLElement>("main")?.focus();
    return;
  }
  const focusables = getFocusable(group);
  const here = focusables.indexOf(anchor);
  const outside = focusables.filter((element) => !item.contains(element));
  const next =
    outside.find((element) => focusables.indexOf(element) > here) ??
    outside.at(-1);
  (next ?? anchor.closest<HTMLElement>("main"))?.focus();
}

interface FocusTrapOptions {
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  focusOnActivate?: boolean | undefined;
}

/**
 * Confines Tab/Shift+Tab to `containerRef` while `active`, can move focus inside
 * on activation, and returns it to the previously focused element on
 * deactivation. Layers share this so focus never escapes an open layer.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  { initialFocus, focusOnActivate = true }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || container === null) return;

    const previouslyFocused = container.ownerDocument
      .activeElement as HTMLElement | null;

    if (focusOnActivate) {
      (
        initialFocus?.current ??
        getFocusable(container)[0] ??
        container
      ).focus();
    }

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
  }, [active, containerRef, focusOnActivate, initialFocus]);
}
