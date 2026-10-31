import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BUCKETS, measureRepository } from "./lib/code-lines.mjs";

const root = process.cwd();
const manifestPath = path.join(root, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const totals = measureRepository(root);
const measured = Object.fromEntries(
  BUCKETS.map((bucket) => [
    bucket,
    {
      comments: totals[bucket].comments,
      longBlocks: totals[bucket].longBlocks.length,
    },
  ]),
);

if (process.argv.includes("--record")) {
  const recorded = manifest.commentLoad ?? {};
  for (const bucket of BUCKETS) {
    for (const [metric, value] of Object.entries(measured[bucket])) {
      if (value > (recorded[bucket]?.[metric] ?? Number.POSITIVE_INFINITY)) {
        console.error(
          `Comment load only ratchets down: ${bucket} ${metric} is ${value}, recorded ${recorded[bucket][metric]}.`,
        );
        process.exit(1);
      }
    }
  }
  manifest.commentLoad = measured;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("Comment load recorded.");
  process.exit(0);
}

function targetLoad() {
  const target = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : "refs/remotes/origin/HEAD";
  const { status, stdout } = spawnSync(
    "git",
    ["show", `${target}:package.json`],
    { cwd: root, encoding: "utf8" },
  );
  return status === 0 ? JSON.parse(stdout).commentLoad : undefined;
}

const target = targetLoad();
let failed = false;
for (const bucket of BUCKETS) {
  for (const [metric, value] of Object.entries(measured[bucket])) {
    const recorded = manifest.commentLoad?.[bucket]?.[metric];
    const allowed = target?.[bucket]?.[metric] ?? recorded;
    if (!(recorded <= allowed)) {
      failed = true;
      console.error(
        `Comment load was raised: ${bucket} ${metric} is recorded as ${recorded}, the target branch has ${allowed}.`,
      );
    }
    if (!(value <= recorded)) {
      failed = true;
      console.error(
        `Comment load grew: ${bucket} ${metric} is ${value}, recorded ${recorded}. Say it in the code or the commit message instead.`,
      );
    } else if (value < recorded) {
      failed = true;
      console.error(
        `Comment load fell: ${bucket} ${metric} is ${value}, recorded ${recorded}. Run pnpm comments:record to keep the gain.`,
      );
    }
  }
  if (failed) {
    const longest = [...totals[bucket].longBlocks]
      .sort((left, right) => right.length - left.length)
      .slice(0, 5);
    for (const block of longest) {
      console.error(`  ${block.file}:${block.line} ${block.length} lines`);
    }
  }
}
if (failed) process.exit(1);
console.log("Comment load check passed.");
