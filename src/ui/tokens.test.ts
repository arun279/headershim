import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The readout's whole claim to WCAG AA rides on these token values: text pairs
// must clear 4.5:1 and graphical/UI pairs 3:1, in both themes. axe checks
// rendered text, but the tinted roles (a live spine on paper, white on the amber
// Grant fill) are chosen here, so this file is their only gate. It parses the
// real palette and follows var() aliases to their hex, so a regression to an
// invisible hue fails the build.
const css = readFileSync(
  fileURLToPath(new URL("./tokens.css", import.meta.url)),
  "utf8",
);
const settingsCss = readFileSync(
  fileURLToPath(
    new URL("../../entrypoints/options/pages/Settings.css", import.meta.url),
  ),
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

const ROOT = block(":root");

function valueIn(source: string, token: string): string | undefined {
  return new RegExp(`--${token}:\\s*([^;]+);`).exec(source)?.[1]?.trim();
}

function value(source: string, token: string): string {
  const raw = valueIn(source, token);
  if (raw === undefined) throw new Error(`no --${token} in block`);
  return raw;
}

/**
 * Follows var(--x) aliases to their hex the way the cascade resolves them: a
 * theme block only overrides the base tokens, so an alias or an unoverridden
 * token falls back to its :root definition.
 */
function resolve(source: string, token: string): string {
  const raw = valueIn(source, token) ?? value(ROOT, token);
  const alias = /^var\(--([a-z0-9-]+)\)$/.exec(raw);
  if (alias?.[1] !== undefined) {
    return resolve(source, alias[1]);
  }
  if (!/^#[0-9A-Fa-f]{3,6}$/.test(raw)) {
    throw new Error(`--${token} is neither a hex nor a single alias: ${raw}`);
  }
  return raw;
}

function relativeLuminance(color: string): number {
  const numeric = Number.parseInt(color.slice(1), 16);
  const channels = [
    (numeric >> 16) & 255,
    (numeric >> 8) & 255,
    numeric & 255,
  ].map((raw) => {
    const srgb = raw / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function contrast(source: string, a: string, b: string): number {
  const la = relativeLuminance(resolve(source, a));
  const lb = relativeLuminance(resolve(source, b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const THEMES = [
  { name: "light", selector: ":root" },
  { name: "dark", selector: ':root[data-theme="dark"]' },
] as const;

// [text, background] pairs that carry meaning and must read as text (4.5:1).
const TEXT_PAIRS: readonly [string, string][] = [
  ["ink", "paper"],
  ["ink2", "paper"],
  ["ink3", "paper"],
  ["live-ink", "paper"],
  ["amber", "paper"],
  ["stop", "paper"],
  ["on-live", "live-fill"],
  ["on-amber", "amber"],
];

// Graphical/UI pairs that carry state and must clear the 3:1 non-text floor.
const UI_PAIRS: readonly [string, string][] = [
  ["live", "paper"], // the live spine, glyph, and toggle-on track
  ["sw-off", "paper"], // the toggle off track
  ["focus", "paper"], // the focus ring
];

describe.each(THEMES)("$name palette contrast", ({ selector }) => {
  const source = block(selector);

  it.each(TEXT_PAIRS)("%s on %s clears 4.5:1", (text, background) => {
    expect(contrast(source, text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)("%s on %s clears 3:1", (fore, background) => {
    expect(contrast(source, fore, background)).toBeGreaterThanOrEqual(3);
  });
});

describe("the accent, doubled and reserved", () => {
  it("resolves the focus ring to the interactive text hue", () => {
    expect(value(block(":root"), "focus")).toBe("var(--live-ink)");
  });

  it("keeps the running and paused toggle tracks on distinct semantic roles", () => {
    const source = block(":root");
    expect(value(source, "sw-on")).toBe("var(--live)");
    expect(value(source, "sw-paused")).toBe("var(--amber)");
    expect(
      [...source.matchAll(/--sw-([a-z-]+):/g)].map((match) => match[1]).sort(),
    ).toEqual(["off", "on", "paused"]);
  });
});

describe("options settings surface inherits the palette", () => {
  it("draws the segmented theme control on audited surfaces", () => {
    expect(settingsCss).toMatch(
      /\.settings-segments\s*\{[^}]*background:\s*var\(--raise2\)/s,
    );
    expect(settingsCss).toMatch(
      /\.settings-segment\.checked\s*\{[^}]*background:\s*var\(--panel\)/s,
    );
  });

  it.each(THEMES)("$name: the checked segment text clears 4.5:1", ({
    selector,
  }) => {
    expect(contrast(block(selector), "ink", "panel")).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
