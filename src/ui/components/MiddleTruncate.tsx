import { useLayoutEffect, useRef, useState } from "preact/hooks";
import "./MiddleTruncate.css";

/**
 * Splits in the middle so both ends stay visible ("Bearer eyJhbGci…J9.sflKx") —
 * the tail is what tells one secret from another. This is real string-splitting,
 * never CSS end-truncation.
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

let probe: HTMLCanvasElement | undefined;

function charWidth(el: HTMLElement): number {
  probe ??= document.createElement("canvas");
  const ctx = probe.getContext("2d");
  if (ctx === null) return 0;
  ctx.font = getComputedStyle(el).font;
  return ctx.measureText("0").width;
}

interface MiddleTruncateProps {
  value: string;
  /** Fixed character budget; when omitted the width is measured and tracked. */
  maxChars?: number;
  class?: string;
}

export function MiddleTruncate({
  value,
  maxChars,
  class: className,
}: MiddleTruncateProps) {
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
  const truncated = display !== value;

  // The full value shows on hover via `title` and to assistive tech via the
  // owning row's accessible description; when truncated it is also carried in a
  // hidden node the focused row reveals inline, so a sighted keyboard user gets
  // the tooltip-style readout on focus too.
  return (
    <span ref={ref} class={className} title={value}>
      {truncated ? (
        <>
          <span class="mt-clip">{display}</span>
          <span class="mt-full">{value}</span>
        </>
      ) : (
        value
      )}
    </span>
  );
}
