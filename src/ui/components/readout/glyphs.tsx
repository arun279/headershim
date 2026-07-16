import type { HeaderOp } from "../../../core/model";

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

export function GearGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6 3.4 3.4" />
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

export function ShieldGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <path d="M8 1.5l5.5 2v4c0 3.4-2.3 5.6-5.5 7-3.2-1.4-5.5-3.6-5.5-7v-4z" />
      <path d="M5.6 8l1.7 1.7L10.6 6" />
    </svg>
  );
}
