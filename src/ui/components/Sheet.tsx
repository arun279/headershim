import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useFocusTrap } from "../a11y/focus";
import "./Sheet.css";

interface SheetProps {
  label: string;
  header: ComponentChildren;
  children: ComponentChildren;
  pinned?: ComponentChildren;
  class?: string;
  modal?: boolean;
  onKeyDown?: JSX.KeyboardEventHandler<HTMLElement>;
}

/**
 * A popup mode with one capped scroll region. Pinned controls remain ordinary
 * trailing content until the region reaches its height cap, then stay within
 * reach at the bottom of that region.
 */
export function Sheet({
  label,
  header,
  children,
  pinned,
  class: className,
  modal = true,
  onKeyDown,
}: SheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  useFocusTrap(sheetRef, modal, { focusOnActivate: false });

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
    </section>
  );
}
