import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The focus-indicator ratios these tokens carry (the checked-segment ring vs its
// fill, and the ring vs the surface) are non-text contrast that axe's
// color-contrast rule does not evaluate — only tokens.css prose asserts them.
// Parse the real values and hold both the documented ratio and the 3:1 WCAG
// non-text floor, so reverting the ring to an invisible hue fails here.
const css = readFileSync(
  fileURLToPath(new URL("./tokens.css", import.meta.url)),
  "utf8",
);

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match?.[1] === undefined) {
    throw new Error(`no ${selector} block in tokens.css`);
  }
  return match[1];
}

function hex(source: string, token: string): string {
  const match = new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{3,6})`).exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`no --${token} in block`);
  }
  return match[1];
}

function relativeLuminance(color: string): number {
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
    (raw) => {
      const srgb = raw / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    },
  );
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("focus-indicator token contrast", () => {
  const themes = [
    { name: "light", selector: ":root", trace: 5.59, focus: 5.07 },
    {
      name: "dark",
      selector: ':root[data-theme="dark"]',
      trace: 7.66,
      focus: 8.77,
    },
  ];

  it("keeps --focus resolving to --trace so the ring hue is the interactive hue", () => {
    expect(block(":root")).toMatch(/--focus:\s*var\(--trace\)/);
  });

  it.each(
    themes,
  )("$name: the checked-segment ring and the focus ring clear their documented ratios and the 3:1 floor", ({
    selector,
    trace,
    focus,
  }) => {
    const source = block(selector);
    // The a11y-design-2-1 checked-segment ring is --trace-ink over the --trace
    // fill; --focus is --trace over the --panel-0 surface.
    const ringOnFill = contrast(hex(source, "trace"), hex(source, "trace-ink"));
    const ringOnSurface = contrast(
      hex(source, "trace"),
      hex(source, "panel-0"),
    );

    expect(ringOnFill).toBeCloseTo(trace, 1);
    expect(ringOnSurface).toBeCloseTo(focus, 1);
    expect(ringOnFill).toBeGreaterThanOrEqual(3);
    expect(ringOnSurface).toBeGreaterThanOrEqual(3);
  });
});
