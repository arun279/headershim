import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = path.join(root, "vitest.config.ts");
const before = readFileSync(config);
const result = spawnSync(
  path.join(root, "node_modules", ".bin", "vitest"),
  ["run", "--coverage"],
  { cwd: root, stdio: "inherit" },
);

const changed = !before.equals(readFileSync(config));
if (changed) {
  console.error(
    "Coverage raised thresholds in vitest.config.ts. Keep the updated values and rerun the check.",
  );
}
if (result.status !== 0 || changed) {
  process.exitCode = 1;
}
