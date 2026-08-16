import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from "typescript/unstable/ast";

const root = path.resolve(import.meta.dirname, "..");
const playwright = path.join(root, "node_modules", ".bin", "playwright");
const removalsFile = path.join(root, "e2e", "playwright-removals.json");

function listTests(cwd, label) {
  try {
    return JSON.parse(
      execFileSync(playwright, ["test", "--list", "--reporter=json"], {
        cwd,
        encoding: "utf8",
        maxBuffer: 100 * 1024 * 1024,
      }),
    );
  } catch (error) {
    throw new Error(`Cannot list Playwright tests from ${label}: ${error}`);
  }
}

function acknowledgementKey(base, test) {
  return `${base}\0${test}`;
}

function readAcknowledgements(missing, comparisons) {
  try {
    const entries = JSON.parse(readFileSync(removalsFile, "utf8"));
    if (
      !Array.isArray(entries) ||
      entries.some(
        (entry) =>
          typeof entry !== "object" ||
          entry === null ||
          Object.keys(entry).length !== 3 ||
          typeof entry.base !== "string" ||
          entry.base.length === 0 ||
          typeof entry.test !== "string" ||
          entry.test.length === 0 ||
          typeof entry.reason !== "string" ||
          entry.reason.length === 0,
      )
    ) {
      throw new Error("expected an array of { base, test, reason } entries");
    }
    const keys = entries.map(({ base, test }) =>
      acknowledgementKey(base, test),
    );
    if (new Set(keys).size !== keys.length) {
      throw new Error("duplicate base and test entry");
    }
    const activeBases = new Set(comparisons.map(({ base }) => base));
    const active = entries.filter(({ base }) => activeBases.has(base));
    const unmatched = active.filter(
      ({ base, test }) => !missing.get(test)?.comparisons.has(base),
    );
    if (unmatched.length > 0) {
      throw new Error(
        `entries do not match a missing test for their comparison base: ${unmatched.map(({ base, test }) => `${base}: ${test}`).join(", ")}`,
      );
    }
    return new Set(
      active.map(({ base, test }) => acknowledgementKey(base, test)),
    );
  } catch (error) {
    throw new Error(
      `Cannot read Playwright removal acknowledgements from ${path.relative(root, removalsFile)}: ${error}`,
    );
  }
}

function testSet(report, cwd) {
  const tests = new Map();
  const repositoryRoot = realpathSync(cwd);

  function visit(suites, ancestors = []) {
    for (const suite of suites) {
      const titles = suite.file ? ancestors : [...ancestors, suite.title];
      for (const spec of suite.specs ?? []) {
        const file = path
          .relative(
            repositoryRoot,
            path.resolve(report.config.rootDir, spec.file),
          )
          .replaceAll(path.sep, "/");
        const title = [...titles, spec.title].join(" > ");
        for (const test of spec.tests) {
          if (test.expectedStatus !== "skipped") {
            tests.set(`${test.projectName}\0${spec.id}`, {
              acknowledgement: `${test.projectName}: ${file} > ${title}`,
              label: `${file} > ${title} [${spec.id}]`,
              project: test.projectName,
            });
          }
        }
      }
      visit(suite.suites ?? [], titles);
    }
  }

  visit(report.suites);
  return tests;
}

const defaultBranchRefs = [
  "refs/remotes/origin/HEAD",
  "refs/remotes/origin/main",
  "refs/heads/main",
];

function revParse(...args) {
  const result = spawnSync("git", ["rev-parse", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function resolveCommit(target) {
  const commit = revParse("--verify", "--quiet", `${target}^{commit}`);
  if (commit === null) {
    throw new Error(`Cannot resolve comparison ref ${target}.`);
  }
  return commit;
}

function endToEndSources() {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "e2e/specs",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter(
      (file) =>
        /\.[cm]?[jt]sx?$/u.test(file) && existsSync(path.join(root, file)),
    );
}

function rejectSkippedEndToEndTests() {
  const violations = [];
  for (const file of endToEndSources()) {
    const source = readFileSync(path.join(root, file), "utf8");
    const scanner = createScanner(
      true,
      file.endsWith("x") ? LanguageVariant.JSX : LanguageVariant.Standard,
      source,
    );
    const tokens = [];
    for (
      let kind = scanner.scan();
      kind !== SyntaxKind.EndOfFile;
      kind = scanner.scan()
    ) {
      tokens.push({
        kind,
        start: scanner.getTokenStart(),
        text: scanner.getTokenText(),
      });
      if (tokens.length > 4) {
        tokens.shift();
      }
      const directName =
        tokens.at(-3)?.kind === SyntaxKind.DotToken &&
        tokens.at(-2)?.kind === SyntaxKind.Identifier &&
        tokens.at(-1)?.kind === SyntaxKind.OpenParenToken
          ? tokens.at(-2)
          : undefined;
      const computedName =
        tokens.at(-4)?.kind === SyntaxKind.OpenBracketToken &&
        tokens.at(-3)?.kind === SyntaxKind.StringLiteral &&
        tokens.at(-2)?.kind === SyntaxKind.CloseBracketToken &&
        tokens.at(-1)?.kind === SyntaxKind.OpenParenToken
          ? tokens.at(-3)
          : undefined;
      const blocked = directName ?? computedName;
      const name = computedName
        ? computedName.text.slice(1, -1)
        : directName?.text;
      if (blocked && (name === "skip" || name === "fixme")) {
        const line = source.slice(0, blocked.start).split("\n").length;
        violations.push(
          `${file}:${line}: .${name} is not allowed in end-to-end specs.`,
        );
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(violations.join("\n"));
  }
}

function baseTarget() {
  if (process.env.PLAYWRIGHT_BASE_REF) {
    return process.env.PLAYWRIGHT_BASE_REF;
  }
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }
  const target = defaultBranchRefs.find((ref) =>
    revParse("--verify", "--quiet", ref),
  );
  if (target === undefined) {
    throw new Error(
      `Cannot find a default branch to compare against. Looked for ${defaultBranchRefs.join(", ")}; name one in PLAYWRIGHT_BASE_REF.`,
    );
  }
  return target;
}

function defaultBranchComparison(head) {
  const target = baseTarget();
  const targetCommit = resolveCommit(target);
  if (process.env.PLAYWRIGHT_BASE_REF && targetCommit === head) {
    throw new Error("PLAYWRIGHT_BASE_REF must name a commit before HEAD.");
  }
  const result = spawnSync("git", ["merge-base", head, targetCommit], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(
      `Cannot find a merge base between HEAD and ${target}: ${result.stderr.trim()}`,
    );
  }
  return { base: result.stdout.trim(), label: `merge base with ${target}` };
}

function previousRefComparisons() {
  const refs = process.env.PLAYWRIGHT_PREVIOUS_REFS?.trim();
  if (!refs) {
    return [];
  }
  const comparisons = [];
  for (const target of new Set(refs.split(/\s+/))) {
    const base = revParse("--verify", "--quiet", `${target}^{commit}`);
    if (base === null) {
      throw new Error(
        `Cannot resolve previous comparison ref ${target}. Fetch the commit before running this check.`,
      );
    }
    comparisons.push({ base, label: `previous ref ${target}` });
  }
  return comparisons;
}

function uniqueComparisons(comparisons) {
  const byBase = new Map();
  for (const comparison of comparisons) {
    const current = byBase.get(comparison.base);
    if (current === undefined) {
      byBase.set(comparison.base, {
        base: comparison.base,
        labels: [comparison.label],
      });
    } else if (!current.labels.includes(comparison.label)) {
      current.labels.push(comparison.label);
    }
  }
  return [...byBase.values()];
}

function testsAt({ base }) {
  const baseRoot = mkdtempSync(path.join(tmpdir(), "headershim-test-set-"));

  try {
    execFileSync("tar", ["-x", "-C", baseRoot], {
      input: execFileSync("git", ["archive", base], {
        cwd: root,
        maxBuffer: 100 * 1024 * 1024,
      }),
    });
    symlinkSync(
      path.join(root, "node_modules"),
      path.join(baseRoot, "node_modules"),
    );
    if (existsSync(path.join(root, ".wxt"))) {
      symlinkSync(path.join(root, ".wxt"), path.join(baseRoot, ".wxt"));
    }
    return testSet(
      listTests(baseRoot, `comparison snapshot ${base}`),
      baseRoot,
    );
  } finally {
    rmSync(baseRoot, { recursive: true });
  }
}

function missingTests(head, comparisons) {
  const missing = new Map();
  for (const comparison of comparisons) {
    for (const [identity, value] of testsAt(comparison)) {
      if (head.has(identity)) {
        continue;
      }
      const current = missing.get(value.acknowledgement);
      if (current === undefined) {
        missing.set(value.acknowledgement, {
          ...value,
          comparisons: new Map([[comparison.base, comparison.labels]]),
        });
      } else {
        current.comparisons.set(comparison.base, comparison.labels);
      }
    }
  }
  return missing;
}

try {
  rejectSkippedEndToEndTests();
  const headCommit = resolveCommit("HEAD");
  const defaultComparison = defaultBranchComparison(headCommit);
  const comparisons = uniqueComparisons([
    { base: headCommit, label: "committed HEAD" },
    defaultComparison,
    ...previousRefComparisons(),
  ]);
  const head = testSet(listTests(root, "the working tree"), root);
  const missing = missingTests(head, comparisons);
  const acknowledged = readAcknowledgements(missing, comparisons);
  const unacknowledged = [...missing]
    .map(([test, value]) => [
      test,
      {
        ...value,
        comparisons: new Map(
          [...value.comparisons].filter(
            ([base]) => !acknowledged.has(acknowledgementKey(base, test)),
          ),
        ),
      },
    ])
    .filter(([, value]) => value.comparisons.size > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [test, value] of unacknowledged) {
    for (const [base, labels] of value.comparisons) {
      console.error(
        `Playwright test absent from head project "${value.project}" compared with ${labels.join(" and ")} at ${base}: ${value.label}`,
      );
      console.error(
        `Acknowledge a deliberate removal in e2e/playwright-removals.json with ${JSON.stringify({ base, test, reason: "Explain why this test was removed." })}.`,
      );
    }
  }
  if (unacknowledged.length > 0) {
    process.exitCode = 1;
  } else {
    const suffix = comparisons.length === 1 ? "" : "s";
    console.log(
      `No unacknowledged Playwright project test removals across ${comparisons.length} comparison snapshot${suffix}.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
