import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(import.meta.dirname, "..");
const assetsDir = path.join(root, "assets");
const outDir = path.join(root, "public", "icon");

// Small sizes render from the favicon-optimized mark so the shim survives the
// reduction; large sizes render from the detailed logo.
const targets = [
  { size: 16, source: "logo-16.svg" },
  { size: 32, source: "logo-16.svg" },
  { size: 48, source: "logo.svg" },
  { size: 128, source: "logo.svg" },
];

const sources = new Map();
function render(source, size) {
  let svg = sources.get(source);
  if (svg === undefined) {
    svg = readFileSync(path.join(assetsDir, source), "utf8");
    sources.set(source, svg);
  }
  return new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  })
    .render()
    .asPng();
}

const check = process.argv.includes("--check");
const drifted = [];

for (const { size, source } of targets) {
  const png = render(source, size);
  const file = path.join(outDir, `icon-${size}.png`);
  if (check) {
    if (!readFileSync(file).equals(png)) {
      drifted.push(`icon-${size}.png`);
    }
  } else {
    writeFileSync(file, png);
    console.log(`icon-${size}.png (${png.length} bytes)`);
  }
}

if (check) {
  if (drifted.length > 0) {
    console.error(
      `Icons out of date: ${drifted.join(", ")}. Run "pnpm icons".`,
    );
    process.exit(1);
  }
  console.log("Icons are up to date.");
}
