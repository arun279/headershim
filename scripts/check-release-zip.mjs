import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, ".output");
const buildDir = path.join(outDir, "chrome-mv3");
const zipPath = process.argv[2] ?? defaultZipPath();

function defaultZipPath() {
  const zips = readdirSync(outDir)
    .filter((entry) => entry.endsWith(".zip"))
    .map((entry) => path.join(outDir, entry));

  if (zips.length !== 1) {
    console.error(`Expected one .output/*.zip archive, found ${zips.length}.`);
    process.exit(1);
  }

  return zips[0];
}

function relativeBuildFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return relativeBuildFiles(full);
    }
    return [path.relative(buildDir, full).split(path.sep).join("/")];
  });
}

const entries = execFileSync("unzip", ["-Z1", zipPath], {
  encoding: "utf8",
})
  .split("\n")
  .filter((entry) => entry !== "" && !entry.endsWith("/"))
  .sort();
const buildFiles = relativeBuildFiles(buildDir).sort();
const entrySet = new Set(entries);
const buildFileSet = new Set(buildFiles);

const violations = [
  ...entries
    .filter((entry) => entry.endsWith(".map"))
    .map((entry) => `Source map in release archive: ${entry}`),
  ...entries
    .filter((entry) => !buildFileSet.has(entry))
    .map((entry) => `Archive entry has no built file: ${entry}`),
  ...buildFiles
    .filter((file) => !entrySet.has(file))
    .map((file) => `Built file missing from archive: ${file}`),
];

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  console.error(
    `\n${violations.length} release archive violation(s). The zip must exactly match .output/chrome-mv3 and include no source maps.`,
  );
  process.exit(1);
}

console.log("Release zip check passed.");
