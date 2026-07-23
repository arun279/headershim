import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Guards against committed code/docs/tests referencing material that isn't in
// this repo: private planning-doc citations, internal task/finding ids, and
// process framing (checklists, review rounds, handoffs) a reader with only
// the repo has no way to resolve. See README/e2e/README.md for the
// reader-facing alternative each of these was rewritten into.

const root = path.resolve(import.meta.dirname, "..");
const SELF_PATH = "scripts/check-self-contained.mjs";

// Files this check does not scan: the lockfile's base64 hashes coincidentally
// contain lookalike substrings, and this file's own pattern literals would
// otherwise flag themselves.
const EXCLUDED_FILES = new Set(["pnpm-lock.yaml", SELF_PATH]);

// Extensions (and a few exact names) worth scanning: source, styles, docs,
// tests, config, and CI. Lockfiles, binaries, and generated fixtures with
// opaque hash/byte content are left out via EXCLUDED_FILES / extension choice.
const INCLUDED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".html",
]);
const INCLUDED_EXACT_NAMES = new Set([
  ".githooks/pre-commit",
  ".githooks/pre-push",
]);

const RULES = [
  {
    name: "private-doc-citation",
    pattern: /\b(?:SPEC|DESIGN|ARCHITECTURE)\b/g,
    hint: "cites a private planning document: inline the actual constraint instead",
  },
  {
    name: "section-symbol",
    pattern: /§/g,
    hint: "cites a section of a document that isn't committed: inline the constraint instead",
  },
  {
    name: "finding-id",
    pattern:
      /\b(?:correctness-\d+(?:-\d+)?|SEC\d+(?:-\d+)?|SIMP\d+(?:-\d+)?|TEST\d+(?:-\d+)?|SF\d+(?:-\d+)?|a11y-design-\d+(?:-\d+)?|T\d{2})\b/g,
    hint: "references an internal task/finding id: describe the behavior instead",
  },
  {
    name: "review-verdict-tag",
    pattern: /\bverdict\s+P\d\b/g,
    hint: "references an internal review-priority tag: state the actual reasoning instead",
  },
  {
    name: "case-id",
    pattern: /\bcase\s+\d+\b/gi,
    hint: "references an internal test-case number: use a descriptive name instead",
  },
  {
    name: "checklist",
    pattern: /\bchecklists?\b/gi,
    hint: 'references a "checklist" that isn\'t in the repo: describe what to verify and how',
  },
  {
    name: "verification-phase",
    pattern: /verification phase/gi,
    hint: "references an internal review phase: describe the actual status instead",
  },
  {
    name: "spike",
    pattern: /\bspikes?\b/gi,
    hint: 'references a "spike" (exploratory work) that isn\'t in the repo',
  },
  {
    name: "gate-table",
    pattern: /gate table/gi,
    hint: "references an internal gate/decision table",
  },
  {
    name: "handoff",
    pattern: /\bhandoffs?\b/gi,
    hint: 'references a process "handoff": describe the actual transition instead',
  },
  {
    name: "round-n",
    pattern: /\bround\s+\d+\b/gi,
    hint: "references a numbered review round",
  },
  {
    name: "packed-real-chrome-checklist",
    pattern: /packed\/real-chrome/gi,
    hint: 'references the "packed/real-Chrome checklist": describe the manual verification directly',
  },
  {
    // content-disposition is the real HTTP header name; only the bare,
    // process-flavored "disposition" is banned.
    name: "disposition",
    pattern: /(?<!content-)\bdisposition\b/gi,
    hint: 'references a process "disposition" (content-disposition, the HTTP header, is exempt)',
  },
];

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => file.length > 0)
    .filter((file) => existsSync(path.join(root, file)))
    .filter((file) => !EXCLUDED_FILES.has(file))
    .filter(
      (file) =>
        INCLUDED_EXACT_NAMES.has(file) ||
        INCLUDED_EXTENSIONS.has(path.extname(file)),
    );
}

const violations = [];
for (const file of trackedFiles()) {
  const lines = readFileSync(path.join(root, file), "utf8").split("\n");
  for (const rule of RULES) {
    lines.forEach((line, index) => {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(line);
      if (match !== null) {
        violations.push(
          `${file}:${index + 1}: [${rule.name}] "${match[0]}": ${rule.hint}`,
        );
      }
    });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  console.error(
    `\n${violations.length} self-contained-repo violation(s): a reader with only this repo can't resolve these references. Inline the real constraint instead of citing external material.`,
  );
  process.exit(1);
}

console.log("Self-contained check passed.");
