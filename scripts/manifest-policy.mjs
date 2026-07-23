import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, ".output/chrome-mv3/manifest.json"), "utf8"),
);
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const violations = [];
const isRelease = process.argv.includes("--release");

function containsKey(value, key) {
  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, key));
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([entryKey, entryValue]) =>
      entryKey === key || containsKey(entryValue, key),
  );
}

function hasExactly(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual
      .toSorted()
      .every((value, index) => value === expected.toSorted()[index])
  );
}

if (manifest.manifest_version !== 3) {
  violations.push("manifest_version must be 3");
}

const requiredPermissions = [
  "declarativeNetRequestWithHostAccess",
  "storage",
  "activeTab",
];
if (!hasExactly(manifest.permissions, requiredPermissions)) {
  violations.push(
    'permissions must contain exactly "declarativeNetRequestWithHostAccess", "storage", and "activeTab"',
  );
}
if (!hasExactly(manifest.optional_host_permissions, ["*://*/*"])) {
  violations.push('optional_host_permissions must contain exactly "*://*/*"');
}
if (
  manifest.host_permissions !== undefined &&
  (!Array.isArray(manifest.host_permissions) ||
    manifest.host_permissions.length > 0)
) {
  violations.push("host_permissions must be absent or empty");
}
if (
  manifest.optional_permissions !== undefined &&
  (!Array.isArray(manifest.optional_permissions) ||
    manifest.optional_permissions.length > 0)
) {
  violations.push("optional_permissions must be absent or empty");
}
if (manifest.content_scripts !== undefined) {
  violations.push("content_scripts must be absent");
}
if (manifest.web_accessible_resources !== undefined) {
  violations.push("web_accessible_resources must be absent");
}
if (manifest.sandbox !== undefined) {
  violations.push("sandbox must be absent");
}
// connect-src 'none' is what makes "the extension's own pages and worker cannot
// open fetch, XHR, WebSocket, EventSource, or sendBeacon" browser-enforced
// rather than a claim; it does not cover images, media, fonts, frames, forms, or
// navigations, so it is one of the two facts PRIVACY.md states, not the whole
// story. check-no-network.mjs holds the other one, that the built files carry no
// call written to any of them. Match this one exactly: a subset check passes while
// a directive is silently dropped, and this policy previously inspected a key
// the built manifest did not even have.
const REQUIRED_CSP =
  "script-src 'self'; object-src 'self'; connect-src 'none';";
if (manifest.content_security_policy?.extension_pages !== REQUIRED_CSP) {
  violations.push(
    `content_security_policy.extension_pages must be exactly "${REQUIRED_CSP}" (found: ${JSON.stringify(manifest.content_security_policy?.extension_pages)})`,
  );
}
if (manifest.content_security_policy?.sandbox !== undefined) {
  violations.push("content_security_policy.sandbox must be absent");
}

// The options surface is a full-width management page; it must open in a real
// tab. Chrome's default embedded dialog (open_in_tab: false) crushes the layout
// into an unusable narrow column.
if (manifest.options_ui?.open_in_tab !== true) {
  violations.push("options_ui.open_in_tab must be true");
}

const allowedCommands = ["_execute_action", "toggle-pause", "next-profile"];
const unexpectedCommands = Object.keys(manifest.commands ?? {}).filter(
  (command) => !allowedCommands.includes(command),
);
if (unexpectedCommands.length > 0) {
  violations.push(`unexpected commands: ${unexpectedCommands.join(", ")}`);
}

const prohibitedPermissions = [
  "webRequest",
  "scripting",
  "declarativeNetRequestFeedback",
  "tabs",
];
const presentProhibitedPermissions = prohibitedPermissions.filter(
  (permission) => manifest.permissions?.includes(permission),
);
if (presentProhibitedPermissions.length > 0) {
  violations.push(
    `permissions must not contain: ${presentProhibitedPermissions.join(", ")}`,
  );
}
if (containsKey(manifest, "remotely_hosted_code")) {
  violations.push(
    "remotely_hosted_code must not appear anywhere in the manifest",
  );
}
if (
  packageJson.dependencies === null ||
  Array.isArray(packageJson.dependencies) ||
  typeof packageJson.dependencies !== "object" ||
  Object.keys(packageJson.dependencies).length > 0
) {
  violations.push('package.json "dependencies" must be exactly {}');
}
if (manifest.version !== packageJson.version) {
  violations.push("manifest version must equal package.json version");
}
if (isRelease) {
  const releaseTag = process.env.RELEASE_TAG;
  if (!releaseTag) {
    violations.push("RELEASE_TAG must be set when --release is used");
  } else if (manifest.version !== releaseTag.replace(/^v/, "")) {
    violations.push(
      `manifest version (${manifest.version}) must equal release tag (${releaseTag})`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`Manifest policy violation: ${violation}`);
  }
  process.exit(1);
}

console.log("Manifest policy passed.");
