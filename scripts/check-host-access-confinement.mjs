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
  let state = IDLE;
  let callStart = -1;
  // One counter per open template substitution (`${`): scan() does not know
  // template nesting on its own, so a `}` that closes a substitution reads
  // as an ordinary brace unless reScanTemplateToken tells the scanner to
  // resume template text. A `{` inside the substitution counts against that
  // same counter first, so an object literal there is not mistaken for the
  // substitution's close.
  const templateDepths = [];
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    kind = scanTemplateToken(scanner, templateDepths, kind);
    if (state !== IDLE) {
      state = testCallState(state, kind);
      if (state === IN_CALL) {
        const end = scanCallEnd(scanner, templateDepths);
        if (end !== undefined) ranges.push([callStart, end]);
        state = IDLE;
        previousKind = SyntaxKind.CloseParenToken;
        continue;
      }
      previousKind = kind;
      continue;
    }
    if (
      kind === SyntaxKind.Identifier &&
      scanner.getTokenText() === "test" &&
      previousKind !== SyntaxKind.DotToken
    ) {
      state = AFTER_TEST;
      callStart = scanner.getTokenStart();
    }
    previousKind = kind;
  }
  return ranges;
}

function scanCallEnd(scanner, templateDepths) {
  let depth = 1;
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    kind = scanTemplateToken(scanner, templateDepths, kind);
    if (kind === SyntaxKind.OpenParenToken) depth += 1;
    else if (kind === SyntaxKind.CloseParenToken) {
      depth -= 1;
      if (depth === 0) return scanner.getTokenEnd();
    }
  }
  return undefined;
}

const IDLE = "idle";
const AFTER_TEST = "after test";
const AFTER_DOT = "after test.";
const AFTER_MEMBER = "after test.member";
const IN_CALL = "in call";

function testCallState(state, kind) {
  switch (state) {
    case AFTER_TEST:
      if (kind === SyntaxKind.OpenParenToken) return IN_CALL;
      return kind === SyntaxKind.DotToken ? AFTER_DOT : IDLE;
    case AFTER_DOT:
      return kind === SyntaxKind.Identifier ? AFTER_MEMBER : IDLE;
    case AFTER_MEMBER:
      return kind === SyntaxKind.OpenParenToken ? IN_CALL : IDLE;
    default:
      return IDLE;
  }
}

function scanTemplateToken(scanner, templateDepths, kind) {
  if (kind === SyntaxKind.TemplateHead) {
    templateDepths.push(0);
  } else if (templateDepths.length > 0 && kind === SyntaxKind.OpenBraceToken) {
    templateDepths[templateDepths.length - 1] += 1;
  } else if (templateDepths.length > 0 && kind === SyntaxKind.CloseBraceToken) {
    if (templateDepths[templateDepths.length - 1] > 0) {
      templateDepths[templateDepths.length - 1] -= 1;
    } else {
      kind = scanner.reScanTemplateToken(false);
      if (kind === SyntaxKind.TemplateTail) templateDepths.pop();
    }
  }
  return kind;
}

const SEEDER = "seedStateAndWait(";
// A helper that wraps the seeder inherits its precondition.
const WRAPPING_HELPERS = ["openPopupOnHost("];
const CONFINED_CALLS = [SEEDER, ...WRAPPING_HELPERS];

const HOST_ACCESS_TAG = /\btag\s*:\s*["']@host-access["']/u;
const HOST_ACCESS_TITLE = /^test(?:\.\w+)?\(\s*["']@host-access\b/u;

const violations = [];
for (const file of endToEndSpecs()) {
  const source = readFileSync(path.join(root, file), "utf8");
  for (const [start, end] of testCallRanges(file, source)) {
    const span = source.slice(start, end);
    const call = CONFINED_CALLS.find((target) => span.includes(target));
    if (call === undefined) continue;
    if (HOST_ACCESS_TAG.test(span) || HOST_ACCESS_TITLE.test(span)) continue;
    const line = source.slice(0, start).split("\n").length;
    violations.push(
      `${file}:${line}: ${call}...) called in a test not confined to @host-access.`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  console.error(
    `\n${violations.length} unconfined host-access seeder call(s): confine the test with tag: "@host-access" (or a leading "@host-access" title word), or seed with seedState instead.`,
  );
  process.exit(1);
}

console.log("Host-access confinement check passed.");
