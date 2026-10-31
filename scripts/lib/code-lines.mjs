import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseSync } from "oxc-parser";

export const BUCKETS = ["product", "tests", "scripts"];

const TEST_FILE =
  /\.test\.[cm]?[jt]sx?$|\.fake\.ts$|(^|\/)test-[^/]*\.ts$|^src\/test\/|^src\/ui\/test\/|^e2e\//;
const LINT_PRAGMA = /^(?:\/\/|\/\*)\s*biome-ignore/;
const TYPE_PRAGMA = /^(?:\/\/|\/\*)\s*@ts-expect-error/;
const LONG_BLOCK_LINES = 3;

function bucketOf(file) {
  if (!/\.(?:css|[cm]?[jt]sx?)$/.test(file)) return undefined;
  if (TEST_FILE.test(file)) return "tests";
  if (file.startsWith("scripts/")) return "scripts";
  if (/^(?:src|entrypoints)\//.test(file)) return "product";
  return undefined;
}

function commentSpans(file, source) {
  if (file.endsWith(".css")) {
    return [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
  }
  return parseSync(file, source).comments;
}

function lineCounter(source) {
  const starts = [...source.matchAll(/\n/g)].map((match) => match.index);
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (starts[middle] < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
}

function measureFile(file, source) {
  const lineOf = lineCounter(source);
  const typeChecked = /\.tsx?$/.test(file);
  const commentLines = new Set();
  for (const { start, end } of commentSpans(file, source)) {
    const text = source.slice(start, end);
    if (LINT_PRAGMA.test(text) || (typeChecked && TYPE_PRAGMA.test(text))) {
      continue;
    }
    for (let line = lineOf(start); line <= lineOf(end - 1); line += 1) {
      commentLines.add(line);
    }
  }
  const ordered = [...commentLines].sort((left, right) => left - right);
  const blocks = [];
  for (const line of ordered) {
    const last = blocks.at(-1);
    if (last?.end === line - 1) last.end = line;
    else blocks.push({ start: line, end: line });
  }
  const filled = source.split("\n").filter((line) => line.trim() !== "").length;
  return {
    code: filled - commentLines.size,
    comments: commentLines.size,
    longBlocks: blocks
      .filter(({ start, end }) => end - start + 1 > LONG_BLOCK_LINES)
      .map(({ start, end }) => ({
        file,
        line: start + 1,
        length: end - start + 1,
      })),
  };
}

export function measureRepository(root) {
  const totals = Object.fromEntries(
    BUCKETS.map((bucket) => [bucket, { code: 0, comments: 0, longBlocks: [] }]),
  );
  const files = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file !== "" && existsSync(`${root}/${file}`));
  for (const file of files) {
    const bucket = bucketOf(file);
    if (bucket === undefined) continue;
    const measured = measureFile(file, readFileSync(`${root}/${file}`, "utf8"));
    totals[bucket].code += measured.code;
    totals[bucket].comments += measured.comments;
    totals[bucket].longBlocks.push(...measured.longBlocks);
  }
  return totals;
}
