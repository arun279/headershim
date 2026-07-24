import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  managedPolicyDir,
  managedPolicyFile,
  updatesUrl,
} from "./constants.mjs";
import { idPath } from "./pack.mjs";

// Renders the force-install policy and drops it in Chrome's machine-managed
// directory. force_installed pulls the CRX from the local update server.
// runtime_allowed_hosts is not a grant: Chromium documents it as an exception to
// runtime_blocked_hosts, it confers no host access on its own, and it does not
// show up in permissions.getAll. These specs therefore still lack the per-site
// grant they need, which is one more reason they are skipped. Installing touches
// system state under /etc, so it is Linux-only by construction and refuses to
// run anywhere else.

const here = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(here, "policy", "managed-policy.json");

export function renderPolicy({ extensionId, updateUrl }) {
  const template = readFileSync(templatePath, "utf8");
  const rendered = template
    .replaceAll("__EXTENSION_ID__", extensionId)
    .replaceAll("__UPDATE_URL__", updateUrl);
  return JSON.parse(rendered);
}

export function installManagedPolicy() {
  if (process.platform !== "linux") {
    throw new Error(
      `Managed-policy install writes to ${managedPolicyDir} and only runs on Linux; refusing on ${process.platform}.`,
    );
  }
  const extensionId = readFileSync(idPath, "utf8").trim();
  const policy = renderPolicy({ extensionId, updateUrl: updatesUrl });
  mkdirSync(managedPolicyDir, { recursive: true });
  const target = path.join(managedPolicyDir, managedPolicyFile);
  writeFileSync(target, `${JSON.stringify(policy, null, 2)}\n`);
  return { target, extensionId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { target, extensionId } = installManagedPolicy();
  process.stdout.write(`Installed policy for ${extensionId} at ${target}\n`);
}
