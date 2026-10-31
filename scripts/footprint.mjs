import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUCKETS, measureRepository } from "./lib/code-lines.mjs";

const MARKER = "<!-- code-footprint -->";
const SOURCES = ["src", "entrypoints", "scripts", "e2e"];
const HEAD_TOOLS = path.join(import.meta.dirname, "..", "node_modules", ".bin");

function cyclomatic(root) {
  const directory = mkdtempSync(path.join(tmpdir(), "footprint-"));
  const config = path.join(directory, "oxlint.json");
  writeFileSync(
    config,
    JSON.stringify({
      categories: { correctness: "off" },
      rules: { complexity: ["error", { max: 0, variant: "modified" }] },
    }),
  );
  const { stdout } = spawnSync(
    path.join(HEAD_TOOLS, "oxlint"),
    ["-c", config, "--format=json", ...SOURCES],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 },
  );
  rmSync(directory, { recursive: true });
  return JSON.parse(stdout).diagnostics.flatMap(({ message }) => {
    const match = message.match(/complexity of (\d+)/);
    return match === null ? [] : [Number(match[1])];
  });
}

function cognitive(root) {
  const directory = mkdtempSync(path.join(tmpdir(), "footprint-"));
  writeFileSync(
    path.join(directory, "biome.json"),
    JSON.stringify({
      root: true,
      formatter: { enabled: false },
      assist: { enabled: false },
      linter: {
        rules: {
          recommended: false,
          complexity: {
            noExcessiveCognitiveComplexity: {
              level: "error",
              options: { maxAllowedComplexity: 1 },
            },
          },
        },
      },
    }),
  );
  const { stdout, stderr } = spawnSync(
    path.join(HEAD_TOOLS, "biome"),
    [
      "lint",
      `--config-path=${directory}`,
      "--colors=off",
      "--max-diagnostics=none",
      ...SOURCES,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 },
  );
  rmSync(directory, { recursive: true });
  return [...`${stdout}${stderr}`.matchAll(/complexity score from (\d+)/g)].map(
    (match) => Number(match[1]),
  );
}

function summarize(scores) {
  return {
    max: Math.max(0, ...scores),
    total: scores.reduce((sum, score) => sum + score, 0),
  };
}

function measure(root) {
  const lines = measureRepository(root);
  const sizes = JSON.parse(
    spawnSync(path.join(HEAD_TOOLS, "size-limit"), ["--json"], {
      cwd: root,
      encoding: "utf8",
    }).stdout,
  );
  return {
    code: Object.fromEntries(BUCKETS.map((name) => [name, lines[name].code])),
    comments: Object.fromEntries(
      BUCKETS.map((name) => [name, lines[name].comments]),
    ),
    bytes: Object.fromEntries(sizes.map(({ name, size }) => [name, size])),
    cyclomatic: summarize(cyclomatic(root)),
    cognitive: summarize(cognitive(root)),
  };
}

function row(label, before, after) {
  const change = after - before;
  const signed = change > 0 ? `+${change}` : String(change);
  return `| ${label} | ${before} | ${after} | ${change === 0 ? "0" : signed} |`;
}

function section(title, before, after) {
  return Object.keys(after).map((name) =>
    row(`${title}: ${name}`, before[name] ?? 0, after[name]),
  );
}

export function report(base, head) {
  return [
    MARKER,
    "### Code footprint",
    "",
    "| | base | this PR | change |",
    "| --- | ---: | ---: | ---: |",
    ...section("code lines", base.code, head.code),
    ...section("comment lines", base.comments, head.comments),
    ...section("brotli bytes", base.bytes, head.bytes),
    ...section("cyclomatic complexity", base.cyclomatic, head.cyclomatic),
    ...section("cognitive complexity", base.cognitive, head.cognitive),
    "",
  ].join("\n");
}

const [command, first, second] = process.argv.slice(2);
if (command === "measure") {
  console.log(JSON.stringify(measure(path.resolve(first ?? "."))));
} else if (command === "report") {
  console.log(
    report(
      JSON.parse(readFileSync(first, "utf8")),
      JSON.parse(readFileSync(second, "utf8")),
    ),
  );
}
