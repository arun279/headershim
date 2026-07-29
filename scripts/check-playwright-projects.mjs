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

function readAcknowledgements(mergeBase, missing) {
  try {
    const entries = JSON.parse(readFileSync(removalsFile, "utf8"));
    if (
      !Array.isArray(entries) ||
      entries.some(
        (entry) =>
          typeof entry !== "object" ||
          entry === null ||
          typeof entry.base !== "string" ||
          typeof entry.test !== "string" ||
          typeof entry.reason !== "string" ||
          entry.reason.length === 0,
      )
    ) {
      throw new Error("expected an array of { base, test, reason } entries");
    }
    const active = entries
      .filter((entry) => entry.base === mergeBase)
      .map((entry) => entry.test);
    const acknowledged = new Set(active);
    if (acknowledged.size !== active.length) {
      throw new Error(`duplicate entry for comparison base ${mergeBase}`);
    }
    const absent = new Set(missing.map(([, value]) => value.acknowledgement));
    const unmatched = active.filter((entry) => !absent.has(entry));
    if (unmatched.length > 0) {
      throw new Error(
        `entries do not match a missing test for comparison base ${mergeBase}: ${unmatched.join(", ")}`,
      );
    }
    return acknowledged;
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
          tests.set(`${test.projectName}\0${spec.id}`, {
            acknowledgement: `${test.projectName}: ${file} > ${title}`,
            label: `${file} > ${title} [${spec.id}]`,
          });
        }
      }
      visit(suite.suites ?? [], titles);
    }
  }

  visit(report.suites);
  return tests;
}

// Run locally there is no pull request to name a base, so the default branch
// stands in for the branch this work will merge into. Naming HEAD instead would
// compare the branch against itself, and every comparison would pass.
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

function baseTarget() {
  if (process.env.PLAYWRIGHT_BASE_REF) {
    return process.env.PLAYWRIGHT_BASE_REF;
  }
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }
  return (
    defaultBranchRefs.find((ref) => revParse("--verify", "--quiet", ref)) ??
    null
  );
}

const target = baseTarget();
if (target === null) {
  console.log(
    `Skipped: no default branch to compare against (looked for ${defaultBranchRefs.join(", ")}). Name one in PLAYWRIGHT_BASE_REF to run this check.`,
  );
  process.exit(0);
}
const mergeBaseResult = spawnSync("git", ["merge-base", "HEAD", target], {
  cwd: root,
  encoding: "utf8",
});
if (mergeBaseResult.status !== 0 || !mergeBaseResult.stdout.trim()) {
  console.error(
    `Cannot find a merge base between HEAD and ${target}: ${mergeBaseResult.stderr.trim()}`,
  );
  process.exit(1);
}
const mergeBase = mergeBaseResult.stdout.trim();
if (mergeBase === revParse("HEAD")) {
  console.log(
    `Skipped: HEAD is already contained in ${target}, so there are no commits to compare.`,
  );
  process.exit(0);
}
const baseRoot = mkdtempSync(path.join(tmpdir(), "headershim-test-set-"));

try {
  execFileSync("tar", ["-x", "-C", baseRoot], {
    input: execFileSync("git", ["archive", mergeBase], {
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

  const head = testSet(listTests(root, "the working tree"), root);
  const missing = [
    ...testSet(listTests(baseRoot, `comparison base ${mergeBase}`), baseRoot),
  ]
    .filter(([identity]) => !head.has(identity))
    .sort(([, left], [, right]) =>
      left.acknowledgement.localeCompare(right.acknowledgement),
    );
  const acknowledged = readAcknowledgements(mergeBase, missing);
  const unacknowledged = missing.filter(
    ([, value]) => !acknowledged.has(value.acknowledgement),
  );

  for (const [identity, value] of unacknowledged) {
    const [project] = identity.split("\0");
    console.error(
      `Playwright test absent from head project "${project}": ${value.label}`,
    );
    console.error(
      `Acknowledge a deliberate removal in e2e/playwright-removals.json with: ${JSON.stringify(value.acknowledgement)}`,
    );
  }
  if (unacknowledged.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(
      `No unacknowledged Playwright project test removals since ${mergeBase}.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(baseRoot, { recursive: true });
}
