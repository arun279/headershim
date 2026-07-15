import type { ComponentChildren, JSX } from "preact";
import "./Sheet.css";

interface SheetProps {
  label: string;
  header: ComponentChildren;
  children: ComponentChildren;
  pinned?: ComponentChildren;
  class?: string;
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
  onKeyDown,
}: SheetProps) {
  return (
    <section
      class={className === undefined ? "sheet" : `sheet ${className}`}
      aria-label={label}
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
