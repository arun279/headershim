import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Enforces the no-em-dash rule on user-facing copy by construction: an em-dash
// (or an en-dash used as one) in shipped copy fails the build. House voice uses
// periods, commas, colons, or a restructure instead. Code comments are exempt,
// so TSX comments are stripped before the scan; copy.ts is scanned whole since
// every character in it ships as prose.

const root = path.resolve(import.meta.dirname, "..");

// Whole-file scans: the single copy source is prose end to end, comments
// included.
const PROSE_FILES = new Set(["src/ui/copy.ts"]);

// TSX carrying inline copy: scanned with comments removed so only the strings a
// user reads are checked.
function isCopyTsx(file) {
  if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) {
    return false;
  }
  return (
    /^entrypoints\/.*\/pages\//.test(file) ||
    file.startsWith("src/ui/components/")
  );
}

// U+2014 em-dash and U+2013 en-dash; the latter is banned too because it reads
// as an em-dash when used to break a clause.
const DASHES = /[–—]/;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([^:]|^)\/\/.*$/gm, "$1");
}

function copyFiles() {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  }).split("\n");
  const kept = [];
  for (const file of tracked) {
    const isCopy = PROSE_FILES.has(file) || isCopyTsx(file);
    if (isCopy && existsSync(path.join(root, file))) {
      kept.push(file);
    }
  }
  return kept;
}

const violations = [];
for (const file of copyFiles()) {
  const raw = readFileSync(path.join(root, file), "utf8");
  const scanned = PROSE_FILES.has(file) ? raw : stripComments(raw);
  scanned.split("\n").forEach((line, index) => {
    if (DASHES.test(line)) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  console.error(
    `\n${violations.length} em-dash violation(s) in user-facing copy. Rewrite with a period, comma, colon, or restructure the sentence.`,
  );
  process.exit(1);
}

console.log("Em-dash check passed.");
