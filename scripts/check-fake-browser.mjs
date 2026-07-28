import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Tests and Wxt must resolve the same fake browser instance so resets clear
// the globals installed by Wxt. Keeping the package transitive also prevents a
// direct declaration from introducing a second version.

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
if (
  manifest.dependencies?.["@webext-core/fake-browser"] !== undefined ||
  manifest.devDependencies?.["@webext-core/fake-browser"] !== undefined
) {
  console.error("@webext-core/fake-browser must remain transitive through wxt");
  process.exit(1);
}

const pnpmStore = path.join(root, "node_modules", ".pnpm");
if (!existsSync(pnpmStore)) {
  console.error(
    "Cannot verify @webext-core/fake-browser installs: node_modules/.pnpm is missing.",
  );
  process.exit(1);
}

const installs = readdirSync(pnpmStore).filter((entry) =>
  entry.startsWith("@webext-core+fake-browser@"),
);
if (installs.length !== 1) {
  console.error(
    `Expected one @webext-core/fake-browser install, found ${installs.length}.`,
  );
  process.exit(1);
}

console.log("Fake browser dependency check passed.");
