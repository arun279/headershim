import type { ComponentChildren, JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { useFocusTrap } from "../a11y/focus";
import "./Sheet.css";

interface SheetProps {
  label: string;
  header: ComponentChildren;
  children: ComponentChildren;
  pinned?: ComponentChildren;
  note?: ComponentChildren;
  class?: string;
  modal?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  onKeyDown?: JSX.KeyboardEventHandler<HTMLElement>;
}

/**
 * A popup mode with one capped scroll region. Pinned controls remain ordinary
 * trailing content until the region reaches its height cap, then stay within
 * reach at the bottom of that region. A note sits below both and inside the
 * dialog: aria-modal tells assistive technology to ignore everything outside
 * this element, so a standing disclosure has to be within it to be read here.
 */
export function Sheet({
  label,
  header,
  children,
  pinned,
  note,
  class: className,
  modal = true,
  initialFocus,
  onKeyDown,
}: SheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  useFocusTrap(sheetRef, true, { initialFocus, trapFocus: modal });

  return (
    <section
      ref={sheetRef}
      class={className === undefined ? "sheet" : `sheet ${className}`}
      role="dialog"
      aria-modal={modal ? "true" : undefined}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header class="sheet-head">{header}</header>
      <div class="sheet-region">
        <div class="sheet-body">{children}</div>
        {pinned !== undefined && <div class="sheet-pinned">{pinned}</div>}
      </div>
      {note}
    </section>
  );
}
