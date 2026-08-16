import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
// A git hook exports GIT_DIR, which would aim every fixture command at the
// repository running the suite instead of the scratch repository at its cwd,
// and CI exports the GITHUB_* and PLAYWRIGHT_* variables the checker and the
// hook read. The suite controls every input its subjects consume.
const isolatedEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(GIT_|GITHUB_|PLAYWRIGHT_)/.test(name),
    ),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};
const checker = path.join(
  repositoryRoot,
  "scripts/check-playwright-projects.mjs",
);
const hook = path.join(repositoryRoot, ".githooks/pre-push");
const zero = "0".repeat(40);

function report(specs) {
  return {
    config: { rootDir: "." },
    suites: [
      {
        file: "e2e/specs/sample.spec.ts",
        specs: specs.map(({ id, projects, title }) => ({
          file: "e2e/specs/sample.spec.ts",
          id,
          title,
          tests: projects.map(({ expectedStatus = "passed", name }) => ({
            expectedStatus,
            projectName: name,
          })),
        })),
      },
    ],
  };
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: isolatedEnv,
  }).trim();
}

function setReport(cwd, value) {
  writeFileSync(
    path.join(cwd, "report.json"),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function commit(cwd, message) {
  git(cwd, "add", "report.json", "e2e/playwright-removals.json");
  git(cwd, "commit", "-m", message);
}

function createCheckerRepository(t, initialReport) {
  const cwd = mkdtempSync(path.join(tmpdir(), "headershim-gates-"));
  t.after(() => rmSync(cwd, { recursive: true }));
  mkdirSync(path.join(cwd, "scripts"), { recursive: true });
  mkdirSync(path.join(cwd, "e2e"), { recursive: true });
  mkdirSync(path.join(cwd, "node_modules", ".bin"), { recursive: true });
  symlinkSync(
    path.join(repositoryRoot, "node_modules", "typescript"),
    path.join(cwd, "node_modules", "typescript"),
  );
  copyFileSync(
    checker,
    path.join(cwd, "scripts/check-playwright-projects.mjs"),
  );
  writeFileSync(path.join(cwd, "e2e", "playwright-removals.json"), "[]\n");
  const fakePlaywright = path.join(cwd, "node_modules", ".bin", "playwright");
  writeFileSync(
    fakePlaywright,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const value = JSON.parse(fs.readFileSync(path.join(process.cwd(), "report.json"), "utf8"));
value.config.rootDir = process.cwd();
process.stdout.write(JSON.stringify(value));
`,
  );
  chmodSync(fakePlaywright, 0o755);
  setReport(cwd, initialReport);
  git(cwd, "init", "--initial-branch=main");
  assert.equal(
    realpathSync(git(cwd, "rev-parse", "--absolute-git-dir")),
    path.join(realpathSync(cwd), ".git"),
  );
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Gate Test");
  commit(cwd, "initial state");
  return cwd;
}

function createBranchWithAddedTest(t, title) {
  const stable = {
    id: "stable-test",
    title: "stays shipped",
    projects: [{ name: "shipped" }],
  };
  const added = {
    id: "branch-test",
    title,
    projects: [{ name: "shipped" }],
  };
  const cwd = createCheckerRepository(t, report([stable]));
  git(cwd, "switch", "-c", "feature");
  setReport(cwd, report([stable, added]));
  commit(cwd, "add branch test");
  return { added, cwd, stable };
}

function runChecker(cwd, env = {}) {
  return spawnSync(
    process.execPath,
    [path.join(cwd, "scripts/check-playwright-projects.mjs")],
    {
      cwd,
      encoding: "utf8",
      env: { ...isolatedEnv, ...env },
    },
  );
}

test("the project checker compares the working tree with committed HEAD", (t) => {
  const { added, cwd, stable } = createBranchWithAddedTest(
    t,
    "keeps its project",
  );
  const committedHead = git(cwd, "rev-parse", "HEAD");
  setReport(
    cwd,
    report([stable, { ...added, projects: [{ name: "host-access" }] }]),
  );

  const result = runChecker(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /absent from head project "shipped"/);
  assert.match(result.stderr, new RegExp(`committed HEAD at ${committedHead}`));
});

test("the project checker compares an explicitly supplied previous revision", (t) => {
  const { added, cwd, stable } = createBranchWithAddedTest(
    t,
    "starts on the branch",
  );
  const previous = git(cwd, "rev-parse", "HEAD");
  setReport(
    cwd,
    report([stable, { ...added, projects: [{ name: "host-access" }] }]),
  );
  commit(cwd, "change branch test project");

  const result = runChecker(cwd, { PLAYWRIGHT_PREVIOUS_REFS: previous });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    new RegExp(`previous ref ${previous} at ${previous}`),
  );
  assert.match(result.stderr, /starts on the branch/);
});

test("the project checker treats a static skip as a removal", (t) => {
  const cwd = createCheckerRepository(
    t,
    report([
      {
        id: "skipped-test",
        title: "still has to run",
        projects: [{ name: "shipped" }],
      },
    ]),
  );
  setReport(
    cwd,
    report([
      {
        id: "skipped-test",
        title: "still has to run",
        projects: [{ expectedStatus: "skipped", name: "shipped" }],
      },
    ]),
  );

  const result = runChecker(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /still has to run/);
});

test("the project checker rejects skip and fixme calls in end-to-end specs", (t) => {
  const cwd = createCheckerRepository(t, report([]));
  mkdirSync(path.join(cwd, "e2e", "specs"));
  writeFileSync(
    path.join(cwd, "e2e", "specs", "sample.spec.ts"),
    `import { test } from "@playwright/test";
const e2e = test;
test.describe.skip("disabled suite", () => {});
e2e.fixme("disabled test", async () => {});
test["skip"]("computed property", async () => {});
`,
  );

  const result = runChecker(cwd);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /e2e\/specs\/sample\.spec\.ts:3: \.skip is not allowed/,
  );
  assert.match(
    result.stderr,
    /e2e\/specs\/sample\.spec\.ts:4: \.fixme is not allowed/,
  );
  assert.match(
    result.stderr,
    /e2e\/specs\/sample\.spec\.ts:5: \.skip is not allowed/,
  );
});

test("the project checker reports a removed tracked spec instead of ENOENT", (t) => {
  const removed = {
    id: "removed-test",
    title: "was in a deleted file",
    projects: [{ name: "shipped" }],
  };
  const cwd = createCheckerRepository(t, report([removed]));
  const spec = path.join(cwd, "e2e", "specs", "sample.spec.ts");
  mkdirSync(path.dirname(spec));
  writeFileSync(spec, 'import { test } from "@playwright/test";\n');
  git(cwd, "add", "e2e/specs/sample.spec.ts");
  git(cwd, "commit", "-m", "track sample spec");
  rmSync(spec);
  setReport(cwd, report([]));

  const result = runChecker(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /was in a deleted file/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});

test("the project checker validates acknowledgements against active snapshots", (t) => {
  const cwd = createCheckerRepository(t, report([]));
  const base = git(cwd, "rev-parse", "HEAD");
  writeFileSync(
    path.join(cwd, "e2e", "playwright-removals.json"),
    `${JSON.stringify([
      {
        base,
        test: "shipped: e2e/specs/sample.spec.ts > no longer missing",
        reason: "The test runs in the current tree.",
      },
    ])}\n`,
  );

  const result = runChecker(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /do not match a missing test/);
});

test("the project checker rejects duplicate acknowledgements", (t) => {
  const cwd = createCheckerRepository(t, report([]));
  const base = git(cwd, "rev-parse", "HEAD");
  const entry = {
    base,
    test: "shipped: e2e/specs/sample.spec.ts > duplicate",
    reason: "The same removal must appear once.",
  };
  writeFileSync(
    path.join(cwd, "e2e", "playwright-removals.json"),
    `${JSON.stringify([entry, entry])}\n`,
  );

  const result = runChecker(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate base and test entry/);
});

test("the project checker rejects acknowledgement properties it does not use", (t) => {
  const cwd = createCheckerRepository(t, report([]));
  writeFileSync(
    path.join(cwd, "e2e", "playwright-removals.json"),
    `${JSON.stringify([
      {
        base: git(cwd, "rev-parse", "HEAD"),
        note: "not part of the acknowledgement format",
        reason: "The entry has an unsupported property.",
        test: "shipped: e2e/specs/sample.spec.ts > extra property",
      },
    ])}\n`,
  );

  const result = runChecker(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected an array of/);
});

test("the project checker ignores acknowledgements for inactive bases", (t) => {
  const removed = {
    id: "removed-test",
    title: "was removed",
    projects: [{ name: "shipped" }],
  };
  const cwd = createCheckerRepository(t, report([removed]));
  const oldBase = git(cwd, "rev-parse", "HEAD");
  git(cwd, "switch", "-c", "feature");
  setReport(cwd, report([]));
  commit(cwd, "remove test");
  git(cwd, "branch", "--force", "main", "HEAD");
  writeFileSync(
    path.join(cwd, "e2e", "playwright-removals.json"),
    `${JSON.stringify([
      {
        base: oldBase,
        test: "shipped: e2e/specs/sample.spec.ts > was removed",
        reason: "The comparison that contained this test is no longer active.",
      },
    ])}\n`,
  );

  const result = runChecker(cwd);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No unacknowledged/);
});

test("the project checker rejects unavailable previous refs", (t) => {
  const cwd = createCheckerRepository(t, report([]));
  const unavailable = "1".repeat(40);

  const result = runChecker(cwd, {
    PLAYWRIGHT_PREVIOUS_REFS: unavailable,
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    new RegExp(`Cannot resolve previous comparison ref ${unavailable}`),
  );
  assert.match(result.stderr, /Fetch the commit/);
});

test("the project checker fails when no default branch ref exists", (t) => {
  const cwd = createCheckerRepository(t, report([]));
  git(cwd, "switch", "-c", "feature");
  git(cwd, "branch", "--delete", "main");

  const result = runChecker(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot find a default branch/);
  assert.doesNotMatch(result.stdout, /No unacknowledged/);
});

test("the project checker rejects HEAD as an explicit base", (t) => {
  const cwd = createCheckerRepository(t, report([]));

  const result = runChecker(cwd, { PLAYWRIGHT_BASE_REF: "HEAD" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must name a commit before HEAD/);
});

function runHook(t, input, cwd = repositoryRoot) {
  const bin = mkdtempSync(path.join(tmpdir(), "headershim-hook-"));
  t.after(() => rmSync(bin, { recursive: true }));
  const pnpm = path.join(bin, "pnpm");
  writeFileSync(
    pnpm,
    `#!/bin/sh
printf "verify:%s\\n" "\${PLAYWRIGHT_PREVIOUS_REFS-}"
`,
  );
  chmodSync(pnpm, 0o755);
  return spawnSync(hook, ["origin", "unused"], {
    cwd,
    encoding: "utf8",
    env: { ...isolatedEnv, PATH: `${bin}:${process.env.PATH}` },
    input,
  });
}

test("the pre-push hook skips deletion records and empty pushes", (t) => {
  const deleted = runHook(
    t,
    `(delete) ${zero} refs/heads/old ${"1".repeat(40)}\n`,
  );
  const empty = runHook(t, "");
  const unborn = mkdtempSync(path.join(tmpdir(), "headershim-unborn-"));
  t.after(() => rmSync(unborn, { recursive: true }));
  git(unborn, "init", "--initial-branch=main");
  const unbornDeletion = runHook(
    t,
    `(delete) ${zero} refs/heads/old ${"1".repeat(40)}\n`,
    unborn,
  );

  assert.equal(deleted.status, 0);
  assert.match(deleted.stdout, /only ref deletions/);
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /sends no refs/);
  assert.equal(unbornDeletion.status, 0);
  assert.match(unbornDeletion.stdout, /only ref deletions/);
  assert.equal(unbornDeletion.stderr, "");
});

test("the pre-push hook verifies malformed and unterminated updates", (t) => {
  const malformed = runHook(t, "not-a-record");
  const head = git(repositoryRoot, "rev-parse", "HEAD");
  const previous = "1".repeat(40);
  const update = runHook(
    t,
    `refs/heads/current ${head} refs/heads/current ${previous}`,
  );

  assert.equal(malformed.status, 0);
  assert.equal(malformed.stdout, "verify:\n");
  assert.equal(update.status, 0);
  assert.equal(update.stdout, `verify:${previous}\n`);
});

test("workflows provide the comparison history required by the project checker", () => {
  const ci = readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const release = readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.match(ci, /Fetch previous pull request revision/);
  assert.match(ci, /PLAYWRIGHT_PREVIOUS_REFS:.*github\.event\.before/);
  assert.match(release, /fetch-depth: 0/);
  assert.match(release, /PLAYWRIGHT_BASE_REF: HEAD\^/);
});
