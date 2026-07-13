/**
 * The two lamp glyphs of the status grammar: ✓ advisory for a good state,
 * ▲ caution for one needing attention. Decorative — callers pair them with
 * text, never color or shape alone (WCAG 1.4.1).
 */

export function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 6.5 5 9l4.5-5.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
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
