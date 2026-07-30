// The layout invariant sweep: one in-page measurement pass, run through
// page.evaluate, that reads per-element geometry and computed style to find any
// element whose box escapes the fixed surface or is clipped by the author with
// no sanctioned truncation recovery. It measures, it never asserts;
// the spec asserts the returned offender lists are empty. Nothing here encodes a
// pixel, colour, font, or markup shape: it reads only physical bounds every
// design must clear, which is why it survives a redesign.
//
// happy-dom stubs every geometry read to zero, so this only means anything in a
// real layout engine; it is Playwright/Chromium only, the extension's own render
// target.

interface OffenderRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface Offender {
  selector: string;
  axis: "inline" | "block";
  overflowPx: number;
  rect: OffenderRect;
  reason: string;
}

interface SweepResult {
  surfaceWidth: number;
  documentScrollWidth: number;
  pastSurface: Offender[];
  clipped: Offender[];
}

// getBoundingClientRect() is fractional (299.9997) while client/scroll are
// integers, so one CSS px of slack absorbs sub-pixel rounding without hiding a
// real clip. Never a percentage: too coarse to see a small clip.
export const TOLERANCE = 1;

/**
 * Runs inside the page. Self-contained (every helper is nested) so page.evaluate
 * can serialize it, and it closes over nothing but browser globals and the
 * tolerance argument.
 */
export function collectLayoutOffenders(tolerance: number): SweepResult {
  const round = (value: number): number => Math.round(value * 100) / 100;
  const isScroll = (value: string): boolean =>
    value === "auto" || value === "scroll";
  const isClip = (value: string): boolean =>
    value === "hidden" || value === "clip";

  const rectOf = (el: Element): OffenderRect => {
    const r = el.getBoundingClientRect();
    return {
      top: round(r.top),
      right: round(r.right),
      bottom: round(r.bottom),
      left: round(r.left),
      width: round(r.width),
      height: round(r.height),
    };
  };

  // A short, stable path to the culprit so a failure names it: up to four
  // levels of tag plus its first two classes or its id.
  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node !== null && depth < 4; depth += 1) {
      const id = node.getAttribute("id");
      if (id !== null && id !== "") {
        parts.unshift(`${node.tagName.toLowerCase()}#${id}`);
        break;
      }
      const classes = (node.getAttribute("class") ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
      parts.unshift(
        node.tagName.toLowerCase() +
          (classes.length > 0 ? `.${classes.join(".")}` : ""),
      );
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  // Content off to the side of a declared horizontal scroll port is intended
  // scroll, not a clip, so any element inside one is excluded from the escape
  // check.
  const insideHorizontalScroller = (el: Element): boolean => {
    let node = el.parentElement;
    while (node !== null && node !== document.documentElement) {
      if (isScroll(getComputedStyle(node).overflowX)) return true;
      node = node.parentElement;
    }
    return false;
  };

  const surfaceWidth = document.documentElement.clientWidth;
  const pastSurface: Offender[] = [];
  const clipped: Offender[] = [];

  for (const el of Array.from(document.querySelectorAll("*"))) {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      continue;
    }
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // Escape: the border box leaves the fixed surface. A declared horizontal
    // scroll port, and anything inside one, is exempt.
    if (!isScroll(style.overflowX) && !insideHorizontalScroller(el)) {
      const rightOver = rect.right - surfaceWidth;
      const leftOver = -rect.left;
      if (rightOver > tolerance) {
        pastSurface.push({
          selector: selectorOf(el),
          axis: "inline",
          overflowPx: round(rightOver),
          rect: rectOf(el),
          reason: `right edge ${round(rect.right)} exceeds the ${surfaceWidth}px surface`,
        });
      } else if (leftOver > tolerance) {
        pastSurface.push({
          selector: selectorOf(el),
          axis: "inline",
          overflowPx: round(leftOver),
          rect: rectOf(el),
          reason: `left edge ${round(rect.left)} sits left of the surface`,
        });
      }
    }

    // Clip: content clipped by the author with no sanctioned recovery. Three
    // recoveries count: a W3C ellipsis; the truncation contract (overflow
    // clipped, nowrap, and the full value carried in title); a text-free,
    // aria-hidden SVG; or an explicit decorative opt-in. aria-hidden alone is
    // not recovery: visible copy can be hidden from assistive technology when a
    // sibling carries its accessible name. Keyed on the computed contract, not
    // a class name, so any design that truncates the standard way passes and only
    // an unrecoverable clip fails. Decorative exemptions are clips only:
    // decoration that escapes the surface is still a real defect, and the escape
    // check above still fails it.
    //
    // A degenerate box (a 1px dimension) is visually-hidden accessible text (the
    // sr-only pattern, deliberately clipped to hide it from sight while keeping
    // it for assistive tech) or a hairline: never a real content box, so its
    // clip is intended and this check skips it.
    const title = (el.getAttribute("title") ?? "").trim();
    const ellipsis = style.textOverflow.includes("ellipsis");
    const nowrap = style.whiteSpace === "nowrap" || style.whiteSpace === "pre";
    const decorativeSvg =
      el instanceof SVGElement &&
      el.getAttribute("aria-hidden") === "true" &&
      (el.textContent ?? "").trim() === "";
    const visuallyHidden =
      style.position === "absolute" &&
      (style.clip !== "auto" || style.clipPath !== "none");
    const recoverable =
      ellipsis ||
      (nowrap && title !== "") ||
      decorativeSvg ||
      el.closest("[data-decorative]") !== null;

    if (
      rect.width <= 1 &&
      rect.height > 1 &&
      el.scrollWidth > 1 &&
      (el.textContent ?? "").trim() !== "" &&
      el.getAttribute("aria-hidden") !== "true" &&
      !visuallyHidden
    ) {
      pushClip(
        el,
        "inline",
        el.scrollWidth,
        `content collapsed into a ${round(rect.width)}px box`,
      );
    } else if (rect.width > 1 && rect.height > 1) {
      if (
        isClip(style.overflowX) &&
        el.scrollWidth - el.clientWidth > tolerance &&
        !recoverable
      ) {
        pushClip(
          el,
          "inline",
          el.scrollWidth - el.clientWidth,
          `content width ${el.scrollWidth} clipped in a ${el.clientWidth}px box (overflow-x:${style.overflowX}) with no ellipsis or title recovery`,
        );
      }
      if (
        isClip(style.overflowY) &&
        el.scrollHeight - el.clientHeight > tolerance &&
        !recoverable
      ) {
        pushClip(
          el,
          "block",
          el.scrollHeight - el.clientHeight,
          `content height ${el.scrollHeight} clipped in a ${el.clientHeight}px box (overflow-y:${style.overflowY}) with no recovery`,
        );
      }
    }
  }

  function pushClip(
    el: Element,
    axis: "inline" | "block",
    overflow: number,
    reason: string,
  ): void {
    clipped.push({
      selector: selectorOf(el),
      axis,
      overflowPx: round(overflow),
      rect: rectOf(el),
      reason,
    });
  }

  return {
    surfaceWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    pastSurface,
    clipped,
  };
}

/** A readable failure that carries the surface, the culprit, and the pixels. */
export function describeOffenders(
  label: string,
  kind: string,
  offenders: readonly Offender[],
): string {
  if (offenders.length === 0) return `${label}: no ${kind}`;
  const lines = offenders.map(
    (o) =>
      `  ${o.axis} ${o.selector} +${o.overflowPx}px: ${o.reason} (rect ${JSON.stringify(o.rect)})`,
  );
  return `${label}: ${offenders.length} ${kind}\n${lines.join("\n")}`;
}
