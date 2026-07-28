import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const notes = manifest.pnpm?.["//overrides"] ?? [];
const overrides = manifest.pnpm?.overrides ?? {};
const notePattern =
  /^([^:]+): (?=.*\bGHSA-[a-z0-9-]+\b)(?=.*\. Drop when .+\.$).+$/i;
const noteKeys = notes.map((note) => note.match(notePattern)?.[1]).sort();
const overrideKeys = Object.keys(overrides).sort();

if (
  noteKeys.length !== overrideKeys.length ||
  noteKeys.some((key, index) => key !== overrideKeys[index])
) {
  console.error(
    `Override notes do not match override keys.\nNotes: ${noteKeys.join(", ")}\nOverrides: ${overrideKeys.join(", ")}`,
  );
  process.exit(1);
}

if (overrideKeys.length === 0) {
  console.log("Override note check passed.");
  process.exit(0);
}

const wxtNodeModules = path.dirname(
  realpathSync(path.join(root, "node_modules", "wxt")),
);
const webExtRunNodeModules = path.dirname(
  realpathSync(path.join(wxtNodeModules, "web-ext-run")),
);
const packageChecks = [
  {
    directory: path.join(webExtRunNodeModules, "firefox-profile"),
    name: "firefox-profile",
    version: "4.7.0",
    dependencies: { "adm-zip": ["adm-zip", "~0.5.x"] },
  },
  {
    directory: path.join(wxtNodeModules, "web-ext-run"),
    name: "web-ext-run",
    version: "0.2.4",
    dependencies: {
      multimatch: ["multimatch", "6.0.0"],
      tmp: ["tmp", "0.2.5"],
    },
  },
  {
    directory: path.join(webExtRunNodeModules, "fx-runner"),
    name: "fx-runner",
    version: "1.4.0",
    dependencies: { "shell-quote": ["shell-quote", "1.7.3"] },
  },
  {
    directory: path.join(webExtRunNodeModules, "node-notifier"),
    name: "node-notifier",
    version: "10.0.1",
    dependencies: { uuid: ["uuid", "^8.3.2"] },
  },
];

for (const expected of packageChecks) {
  const dependencies = Object.entries(expected.dependencies).filter(
    ([, [override]]) => override in overrides,
  );
  if (dependencies.length === 0) {
    continue;
  }
  const installed = JSON.parse(
    readFileSync(path.join(expected.directory, "package.json"), "utf8"),
  );
  if (installed.version !== expected.version) {
    console.error(
      `${expected.name} resolved to ${installed.version}; expected ${expected.version}. Re-audit pnpm overrides.`,
    );
    process.exit(1);
  }
  for (const [dependency, [, range]] of dependencies) {
    if (installed.dependencies?.[dependency] !== range) {
      console.error(
        `${expected.name} declares ${dependency} ${installed.dependencies?.[dependency]}; expected ${range}. Re-audit pnpm overrides.`,
      );
      process.exit(1);
    }
  }
}

console.log("Override note check passed.");
