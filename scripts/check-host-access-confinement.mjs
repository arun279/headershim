import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from "typescript/unstable/ast";

// seedStateAndWait's precondition, documented on the helper itself
// (e2e/fixtures.ts), is the host-access build: it holds all-sites, so no rule
// is grant-dropped and the plain compile is what the background lands. A test
// that calls it without being confined to that project can pass on an
// accident of its seeded doc (an empty desired set, say) rather than on the
// precondition actually holding, so this fails any such call before it ships.
// Confinement is either form this suite uses: a `tag: "@host-access"` in the
// test's options object, or a leading "@host-access" word in its title.

const root = path.resolve(import.meta.dirname, "..");

function endToEndSpecs() {
  return execFileSync("git", ["ls-files", "e2e/specs"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(
      (file) => /\.[cm]?tsx?$/u.test(file) && existsSync(path.join(root, file)),
    );
}

// The [start, end) source ranges of every top-level `test(...)` call
// (`test(`, `test.only(`, `test.fixme(`, …), found by token-level paren
// matching: a paren sitting inside a string, template, comment, or regex
// literal is a single token to the scanner, so it never miscounts.
function testCallRanges(file, source) {
  const scanner = createScanner(
    true,
    file.endsWith("x") ? LanguageVariant.JSX : LanguageVariant.Standard,
    source,
  );
  const ranges = [];
  let previousKind;
  // 0: idle: looking for a leading `test` identifier.
  // 1: saw `test`: an immediate `(` confirms the call, a `.` opens `test.foo(`.
  // 2: saw `test.`: expects the member identifier.
  // 3: saw `test.foo`: an immediate `(` confirms the call.
  let state = 0;
  let callStart = -1;
  let depth = 0;
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    if (depth > 0) {
      if (kind === SyntaxKind.OpenParenToken) depth += 1;
      else if (kind === SyntaxKind.CloseParenToken) {
        depth -= 1;
        if (depth === 0) ranges.push([callStart, scanner.getTokenEnd()]);
      }
      previousKind = kind;
      continue;
    }
    if (
      state === 0 &&
      kind === SyntaxKind.Identifier &&
      scanner.getTokenText() === "test" &&
      previousKind !== SyntaxKind.DotToken
    ) {
      state = 1;
      callStart = scanner.getTokenStart();
    } else if (state === 1 && kind === SyntaxKind.OpenParenToken) {
      depth = 1;
      state = 0;
    } else if (state === 1 && kind === SyntaxKind.DotToken) {
      state = 2;
    } else if (state === 2 && kind === SyntaxKind.Identifier) {
      state = 3;
    } else if (state === 3 && kind === SyntaxKind.OpenParenToken) {
      depth = 1;
      state = 0;
    } else {
      state = 0;
    }
    previousKind = kind;
  }
  return ranges;
}

const HOST_ACCESS_TAG = /\btag\s*:\s*["']@host-access["']/u;
const HOST_ACCESS_TITLE = /^test(?:\.\w+)?\(\s*["']@host-access\b/u;

const violations = [];
for (const file of endToEndSpecs()) {
  const source = readFileSync(path.join(root, file), "utf8");
  for (const [start, end] of testCallRanges(file, source)) {
    const span = source.slice(start, end);
    if (!span.includes("seedStateAndWait(")) continue;
    if (HOST_ACCESS_TAG.test(span) || HOST_ACCESS_TITLE.test(span)) continue;
    const line = source.slice(0, start).split("\n").length;
    violations.push(
      `${file}:${line}: seedStateAndWait(...) called in a test not confined to @host-access.`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  console.error(
    `\n${violations.length} unconfined seedStateAndWait() call(s): confine the test with tag: "@host-access" (or a leading "@host-access" title word), or seed with seedState instead.`,
  );
  process.exit(1);
}

console.log("Host-access confinement check passed.");
