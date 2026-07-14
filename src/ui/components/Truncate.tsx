import { useLayoutEffect, useRef, useState } from "preact/hooks";
import "./Truncate.css";

/**
 * Splits in the middle so both ends stay visible ("Bearer eyJhbGci…J9.sflKx") —
 * the tail is what tells one secret, token, or registrable domain from another.
 * This is real string-splitting, never CSS end-truncation.
 */
export function truncateMiddle(text: string, max: number): string {
  if (max <= 1 || text.length <= max) return text;
  const budget = max - 1;
  const head = Math.ceil(budget / 2);
  const tail = budget - head;
  return tail > 0
    ? `${text.slice(0, head)}…${text.slice(text.length - tail)}`
    : `${text.slice(0, head)}…`;
}

interface TruncateProps {
  value: string;
  /**
   * "end" (default) clips the tail with a CSS ellipsis — for names and labels
   * whose head carries the meaning. "middle" keeps both ends — for secrets,
   * tokens, and domains where the tail disambiguates.
   */
  mode?: "end" | "middle";
  /**
   * Middle mode only: a fixed character budget for inline contexts that cannot
   * be measured. Omit inside a sized flex/grid cell to track its width live.
   */
  maxChars?: number;
  class?: string;
}

/**
 * The one sanctioned way to render any variable-length string: a secret, header
 * name, domain, profile name, host, or comment. It renders exactly one line,
 * never wraps or reflows on any state (:hover / :focus / :focus-within), always
 * carries the full value in `title`, and shrinks below its own content
 * (min-width: 0) so an ancestor flex/grid cell truncates it instead of
 * overflowing. Full-fidelity readout is a deliberate act (open the editor, or
 * "Copy value"), never an incidental one.
 */
export function Truncate({
  value,
  mode = "end",
  maxChars,
  class: className,
}: TruncateProps) {
  if (mode === "middle") {
    return (
      <MiddleTruncate value={value} maxChars={maxChars} class={className} />
    );
  }
  return (
    <span
      class={className === undefined ? END_CLASS : `${END_CLASS} ${className}`}
      title={value}
    >
      {value}
    </span>
  );
}

const END_CLASS = "truncate truncate-end";

let probe: HTMLCanvasElement | undefined;

function charWidth(el: HTMLElement): number {
  probe ??= document.createElement("canvas");
  const ctx = probe.getContext("2d");
  if (ctx === null) return 0;
  ctx.font = getComputedStyle(el).font;
  return ctx.measureText("0").width;
}

function MiddleTruncate({
  value,
  maxChars,
  class: className,
}: {
  value: string;
  maxChars: number | undefined;
  class: string | undefined;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<number | undefined>(maxChars);

  useLayoutEffect(() => {
    if (maxChars !== undefined) {
      setFit(maxChars);
      return;
    }
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const cw = charWidth(el);
      setFit(
        cw > 0 && el.clientWidth > 0
          ? Math.floor(el.clientWidth / cw)
          : undefined,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxChars, value]);

  const display = fit !== undefined ? truncateMiddle(value, fit) : value;

  return (
    <span
      ref={ref}
      class={className === undefined ? "truncate" : `truncate ${className}`}
      title={value}
    >
      {display}
    </span>
  );
}
