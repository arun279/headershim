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
   * A shared character ceiling for the data type. A mode that cuts the string by
   * hand also measures the rendered result against its live container and takes
   * whichever of the two bites first, because a character count is a different
   * width in every script.
   */
  maxChars?: number;
  class?: string;
}

/**
 * A header value as a row shows it. A secret's reading is fixed text this
 * product wrote, a redaction marker or a generated-value note, not the user's
 * own bytes: cut, it reads as a fragment of a real value, so it is shown whole
 * and the header beside it gives up the room instead. Everything else ends on an
 * ellipsis rather than splitting in the middle, because a middle splice of a
 * value that is code reads as a shorter policy that is valid and wrong.
 */
export function HeaderValue({
  value,
  secret,
  class: className,
}: Pick<TruncateProps, "value" | "class"> & { secret: boolean }) {
  return secret ? (
    <span
      class={`truncate truncate-whole${className === undefined ? "" : ` ${className}`}`}
      title={value}
    >
      {value}
    </span>
  ) : (
    <Truncate
      mode="end"
      value={value}
      maxChars={TRUNCATION_LIMITS.value}
      {...(className === undefined ? {} : { class: className })}
    />
  );
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
  // The two modes that cut the string by hand also measure the column they are
  // cut for; end mode hands that job to the CSS ellipsis, which measures it for
  // free. Either way the character ceiling is a ceiling, not the whole answer:
  // 22 CJK characters take about twice the room 22 Latin ones do.
  if (mode !== "end") {
    return (
      <Measured
        value={value}
        maxChars={maxChars}
        cut={mode === "middle" ? truncateMiddle : truncateWords}
        class={className}
      />
    );
  }
  return (
    <span
      class={className === undefined ? END_CLASS : `${END_CLASS} ${className}`}
      title={value}
    >
      {maxChars === undefined ? value : truncateEnd(value, maxChars)}
    </span>
  );
}

const END_CLASS = "truncate truncate-end";

let probe: HTMLCanvasElement | undefined;

/**
 * Measures candidate strings in the element's own font. The strings themselves
 * are measured, not a stand-in character: a CJK glyph is about twice the width
 * of a Latin one, so a budget counted in characters gives a Japanese value twice
 * the room it has and the column clips it mid-glyph.
 */
function textMeasurer(el: HTMLElement): ((text: string) => number) | undefined {
  probe ??= document.createElement("canvas");
  const ctx = probe.getContext("2d");
  if (ctx === null) return undefined;
  ctx.font = getComputedStyle(el).font;
  return (text) => ctx.measureText(text).width;
}

type Cut = (text: string, max: number) => string;

/** The longest cut of `value` that still fits the live column. */
function fitToColumn(
  el: HTMLElement,
  value: string,
  maxChars: number | undefined,
  cut: Cut,
): string {
  const ceiling = Math.min(maxChars ?? value.length, value.length);
  const measure = textMeasurer(el);
  const width = el.clientWidth;
  if (measure === undefined || width <= 0) {
    return cut(value, ceiling);
  }
  let low = 1;
  let high = ceiling;
  let best = cut(value, low);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = cut(value, mid);
    if (measure(candidate) <= width) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function Measured({
  value,
  maxChars,
  cut,
  class: className,
}: {
  value: string;
  maxChars: number | undefined;
  cut: Cut;
  class: string | undefined;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(() =>
    maxChars === undefined ? value : cut(value, maxChars),
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setDisplay(fitToColumn(el, value, maxChars, cut));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxChars, value, cut]);

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
