import { useLayoutEffect, useRef, useState } from "preact/hooks";
import "./Truncate.css";

export const TRUNCATION_LIMITS = {
  header: 32,
  value: 36,
  domain: 34,
  profile: 22,
} as const;

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

/** Keeps the leading portion and marks a clipped tail. */
export function truncateEnd(text: string, max: number): string {
  if (max <= 1 || text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Prefers a whole-word boundary for human-readable names. */
export function truncateWords(text: string, max: number): string {
  if (max <= 1 || text.length <= max) return text;
  const budget = max - 1;
  const prefix = text.slice(0, budget);
  const boundary = prefix.lastIndexOf(" ");
  return boundary >= Math.floor(budget / 2)
    ? `${prefix.slice(0, boundary).trimEnd()}…`
    : truncateEnd(text, max);
}

interface TruncateProps {
  value: string;
  /**
   * "end" (default) keeps the leading portion. "middle" keeps both ends for
   * machine identifiers and values. "word" keeps profile names on a word
   * boundary when one fits.
   */
  mode?: "end" | "middle" | "word";
  /**
   * A shared character ceiling for the data type. Middle mode also measures
   * its live container and uses the smaller of that width and this ceiling.
   */
  maxChars?: number;
  class?: string;
}

/** Human-readable profile names share one word-boundary treatment. */
export function ProfileName({
  value,
  class: className,
}: Pick<TruncateProps, "value" | "class">) {
  return (
    <Truncate
      mode="word"
      value={value}
      maxChars={TRUNCATION_LIMITS.profile}
      {...(className === undefined ? {} : { class: className })}
    />
  );
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
  const display =
    maxChars === undefined
      ? value
      : mode === "word"
        ? truncateWords(value, maxChars)
        : truncateEnd(value, maxChars);
  return (
    <span
      class={className === undefined ? END_CLASS : `${END_CLASS} ${className}`}
      title={value}
    >
      {display}
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
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const cw = charWidth(el);
      const measured =
        cw > 0 && el.clientWidth > 0
          ? Math.floor(el.clientWidth / cw)
          : undefined;
      setFit(
        measured === undefined
          ? maxChars
          : maxChars === undefined
            ? measured
            : Math.min(measured, maxChars),
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
