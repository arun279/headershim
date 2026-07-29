import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputRoot = ".output/chrome-mv3";
const outputDir = path.join(root, outputRoot);
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);

function emittedFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return emittedFiles(full);
    }
    return [path.relative(root, full)];
  });
}

const files = emittedFiles(outputDir);

function globRegex(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", "[^/]*")}$`);
}

function selectedFiles(entry) {
  const patterns = Array.isArray(entry.path) ? entry.path : [entry.path];
  const includes = patterns
    .filter((pattern) => !pattern.startsWith("!"))
    .map(globRegex);
  const excludes = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => globRegex(pattern.slice(1)));
  return new Set(
    files.filter(
      (file) =>
        includes.some((pattern) => pattern.test(file)) &&
        !excludes.some((pattern) => pattern.test(file)),
    ),
  );
}

const sizeEntries = new Map(
  packageJson["size-limit"].map((entry) => [
    entry.name,
    { entry, files: selectedFiles(entry) },
  ]),
);

function localReference(from, reference) {
  if (reference.startsWith("/")) {
    return path.join(outputRoot, reference.slice(1));
  }
  if (reference.startsWith(".")) {
    return path.normalize(path.join(path.dirname(from), reference));
  }
  return undefined;
}

function dependencies(file) {
  const source = readFileSync(path.join(root, file), "utf8");
  if (path.extname(file) === ".html") {
    return [...source.matchAll(/\b(?:href|src)=["']([^"'?#]+)[^"']*["']/g)]
      .map((match) => localReference(file, match[1]))
      .filter((reference) => reference !== undefined);
  }
  if (path.extname(file) === ".js") {
    return [
      ...source.matchAll(
        /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g,
      ),
    ]
      .map((match) => localReference(file, match[1] ?? match[2]))
      .filter((reference) => reference !== undefined);
  }
  return [];
}

function startupFiles(entryHtml) {
  const pending = [path.join(outputRoot, entryHtml)];
  const startup = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (startup.has(file)) {
      continue;
    }
    if (!files.includes(file)) {
      throw new Error(
        `${file} is referenced by the startup graph but not emitted`,
      );
    }
    startup.add(file);
    pending.push(...dependencies(file));
  }
  return startup;
}

const violations = [];
for (const [name, entryHtml] of [
  ["Popup initial load", "popup.html"],
  ["Options initial load", "options.html"],
]) {
  const budget = sizeEntries.get(name);
  if (budget === undefined) {
    violations.push(`Missing size-limit entry: ${name}`);
    continue;
  }
  const startup = startupFiles(entryHtml);
  for (const file of startup.difference(budget.files)) {
    violations.push(`${name} does not include startup file ${file}`);
  }
  for (const file of budget.files.difference(startup)) {
    violations.push(`${name} includes non-startup file ${file}`);
  }
}

const budgeted = new Set(
  [...sizeEntries.values()].flatMap(({ files: entryFiles }) => [...entryFiles]),
);
for (const file of files.filter((file) =>
  [".css", ".html", ".js"].includes(path.extname(file)),
)) {
  if (!budgeted.has(file)) {
    violations.push(`No size-limit entry includes ${file}`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`Size coverage violation: ${violation}`);
  }
  process.exit(1);
}

console.log("Size coverage passed.");
