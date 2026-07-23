import type { Direction, HeaderOp } from "../../../core/model";
import type { TapeRow } from "../../state/fleet";

/**
 * Which way a change points, in the two characters the popup's direction
 * headings already use. The list surfaces spend their one glyph slot on this
 * rather than on the operation: two rules can be identical but for direction,
 * while the operation is spelled out in the row's own sentence.
 */
export function DirectionGlyph({ direction }: { direction: Direction }) {
  return (
    <span class="mono" aria-hidden="true">
      {direction === "request" ? "→" : "←"}
    </span>
  );
}

/**
 * The readout's shape vocabulary. The operation glyph says what a change does
 * (swap-arrows = set, plus = add, minus = remove); it never carries color
 * meaning — the spine's severity color flows in through currentColor.
 */
export function OpGlyph({ operation }: { operation: HeaderOp }) {
  if (operation === "remove") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d="M3.5 8h9" stroke-width="1.8" />
      </svg>
    );
  }
  if (operation === "append") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d="M8 3v10M3 8h10" stroke-width="1.9" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M3 6h8M9 3l2.5 3L9 9" stroke-width="1.6" />
      <path d="M13 10H5M7 13l-2.5-3L7 7" stroke-width="1.6" />
    </svg>
  );
}

export function GlobeGlyph() {
  return (
    <svg
      class="glb"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 1.6 2.8 3.8 2.8 6S9.8 12.4 8 14M8 2C6.2 3.6 5.2 5.8 5.2 8S6.2 12.4 8 14" />
    </svg>
  );
}

export function ChevronGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function CheckGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"
    >
      <path d="M3 8l3.5 3.5L13 5" />
    </svg>
  );
}

export function TriangleGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1 11.2 10.5H0.8Z" fill="currentColor" />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="m2.5 2.5 7 7m0-7-7 7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
    </svg>
  );
}

export function StatusGlyph({ status }: { status: TapeRow["status"] }) {
  if (status === "refused" || status === "out-of-sync") {
    return (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      >
        <path d="M3 3l6 6m0-6l-6 6" />
      </svg>
    );
  }
  if (status === "paused") {
    return (
      <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="3" y="2.5" width="2" height="7" rx="0.6" />
        <rect x="7" y="2.5" width="2" height="7" rx="0.6" />
      </svg>
    );
  }
  if (status === "needs-access" || status === "managed") {
    return (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="6" r="4" />
    </svg>
  );
}

export function PlusGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function TabGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="3.5"
        width="11"
        height="9"
        rx="1.5"
        stroke-dasharray="2 2"
      />
    </svg>
  );
}

/** A toothed wheel: a solid body, so it never reads as a ringed sun. */
export function GearGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      fill-rule="evenodd"
      aria-hidden="true"
    >
      <path d="M6.7 3L6.9 0.8L9.1 0.8L9.3 3A5.2 5.2 0 0 1 10.7 3.5L12.3 2.1L13.9 3.7L12.5 5.3A5.2 5.2 0 0 1 13 6.7L15.2 6.9L15.2 9.1L13 9.3A5.2 5.2 0 0 1 12.5 10.7L13.9 12.3L12.3 13.9L10.7 12.5A5.2 5.2 0 0 1 9.3 13L9.1 15.2L6.9 15.2L6.7 13A5.2 5.2 0 0 1 5.3 12.5L3.7 13.9L2.1 12.3L3.5 10.7A5.2 5.2 0 0 1 3 9.3L0.8 9.1L0.8 6.9L3 6.7A5.2 5.2 0 0 1 3.5 5.3L2.1 3.7L3.7 2.1L5.3 3.5A5.2 5.2 0 0 1 6.7 3ZM8 5.5A2.5 2.5 0 1 0 8 10.5A2.5 2.5 0 1 0 8 5.5Z" />
    </svg>
  );
}

export function KeyGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <rect x="3.5" y="7" width="9" height="6.2" rx="1.4" />
      <path d="M5.4 7V5.1a2.6 2.6 0 0 1 5.2 0V7" />
    </svg>
  );
}

export function ClockGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6V8l2.4 1.6" />
    </svg>
  );
}
