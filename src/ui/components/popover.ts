import { getFocusable } from "../a11y/focus";

/** Opens a Popover API surface and clamps it to the popup with fixed pixels. */
export function openPositionedPopover(
  popover: HTMLElement,
  trigger: HTMLElement,
  align: "start" | "end" = "start",
) {
  if (typeof popover.showPopover === "function") {
    try {
      popover.showPopover();
    } catch {
      // Repositioning an already-open popover does not need to reopen it.
    }
  } else {
    popover.setAttribute("data-popover-open", "");
  }

  const triggerRect = trigger.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const popup = document
    .querySelector<HTMLElement>(".popup")
    ?.getBoundingClientRect();
  const leftEdge = popup?.width ? popup.left : 0;
  const rightEdge = popup?.width ? popup.right : window.innerWidth;
  const topEdge = popup?.height ? popup.top : 0;
  const bottomEdge = popup?.height ? popup.bottom : window.innerHeight;
  const inset = 8;
  const idealLeft =
    align === "end" ? triggerRect.right - popoverRect.width : triggerRect.left;
  const left = Math.max(
    leftEdge + inset,
    Math.min(idealLeft, rightEdge - popoverRect.width - inset),
  );
  const below = triggerRect.bottom + 4;
  const top =
    below + popoverRect.height <= bottomEdge - inset
      ? below
      : Math.max(topEdge + inset, triggerRect.top - popoverRect.height - 4);

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

export function closePopover(popover: HTMLElement | null) {
  if (popover === null) {
    return;
  }
  if (typeof popover.hidePopover === "function") {
    try {
      popover.hidePopover();
    } catch {
      // Removing a conditionally rendered popover can race its native close.
    }
  }
  popover.removeAttribute("data-popover-open");
}

/** Keeps Tab and Shift+Tab cycling through a menu's controls. */
export function trapPopoverFocus(event: KeyboardEvent, root: HTMLElement) {
  if (event.key !== "Tab") {
    return;
  }
  const items = getFocusable(root);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const active = items.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? (active - 1 + items.length) % items.length
    : (active + 1) % items.length;
  event.preventDefault();
  items[next]?.focus();
}
