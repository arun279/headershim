import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Commit hash embedding moves chunk bytes between amends, so the gate keeps at most 1000 B of slack.
const MAX_SLACK = 1000;
// Grain keeps recorded limits stable while still ratcheting in bounded 250 B steps.
const GRAIN = 250;

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const args = process.argv.slice(2);
const record = args.length === 1 && args[0] === "--record";
if (args.length > 0 && !record) {
  console.error("Usage: node scripts/check-size-slack.mjs [--record]");
  process.exit(1);
}

const results = JSON.parse(
  execFileSync("size-limit", ["--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
const entries = new Map(
  packageJson["size-limit"].map((entry) => [entry.name, entry]),
);
let failed = false;
let changed = false;

for (const result of results) {
  const entry = entries.get(result.name);
  const target = (Math.floor(result.size / GRAIN) + 2) * GRAIN;
  if (record) {
    if (target < result.sizeLimit) {
      entry.limit = `${target} B`;
      changed = true;
      continue;
    }
    if (target > result.sizeLimit) {
      console.error(
        `${result.name} measures ${result.size} B, above its ${result.sizeLimit} B limit. size:record only lowers limits. Raise it in package.json yourself, and say in the commit message what you tried first.`,
      );
    }
    continue;
  }
  const slack = result.sizeLimit - result.size;
  if (slack > MAX_SLACK) {
    console.error(
      `${result.name} is ${result.size} B against a ${result.sizeLimit} B limit: ${slack} B of slack. Slack is where the gate goes blind. Bank it: pnpm size:record`,
    );
    failed = true;
  }
}

if (record && changed) {
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
} else if (failed) {
  process.exit(1);
}
