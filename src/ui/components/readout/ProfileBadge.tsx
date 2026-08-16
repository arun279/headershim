import type { BadgeColor } from "../../../core/model";

/**
 * The one first-class tag: a colored square is always a profile and never
 * anything else. Every other descriptor (JWT, opaque token, This tab only) is
 * the neutral mono-caps style, so the two families never blur.
 */
export function ProfileBadge({
  text,
  color,
  size,
}: {
  text: string;
  color: BadgeColor;
  size: number;
}) {
  return (
    <span
      class="badge-glyph"
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        // Under half the box: two full-width glyphs (a CJK code) then still fit
        // the square instead of clipping against its own rounded edge.
        fontSize: `${Math.round(size * 0.46)}px`,
        background: `var(--badge-${color})`,
      }}
    >
      {text}
    </span>
  );
}
