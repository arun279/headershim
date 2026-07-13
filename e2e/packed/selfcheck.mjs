import { readFileSync } from "node:fs";
import { updatesUrl } from "./constants.mjs";
import { extensionIdForKey, keyPath, pack } from "./pack.mjs";
import { renderPolicy } from "./policy.mjs";
import { startUpdateServer } from "./update-server.mjs";

// Exercises the packing, update-server, and policy-render scripts end to end
// without touching machine policy or launching Chrome, so the tooling can be
// validated on any platform before the Linux-only gate runs in CI.

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const { id, crxPath } = pack();

const crx = readFileSync(crxPath);
assert(
  crx.subarray(0, 4).toString() === "Cr24",
  "CRX is missing its Cr24 magic",
);
assert(crx.readUInt32LE(4) === 3, "CRX is not format version 3");

const spki = readFileSync(keyPath);
assert(
  id === extensionIdForKey(spki),
  "extension id does not match the signing key",
);

const server = await startUpdateServer();
try {
  const manifest = await fetch(updatesUrl).then((r) => r.text());
  assert(manifest.includes(`appid="${id}"`), "update manifest omits the id");
  assert(manifest.includes("/headershim.crx"), "update manifest omits the crx");

  const served = Buffer.from(
    await fetch(`${server.url}/headershim.crx`).then((r) => r.arrayBuffer()),
  );
  assert(served.equals(crx), "served CRX differs from the packed CRX");
} finally {
  await server.close();
}

const policy = renderPolicy({ extensionId: id, updateUrl: updatesUrl });
const settings = policy.ExtensionSettings[id];
assert(settings !== undefined, "policy is not keyed by the extension id");
assert(
  settings.installation_mode === "force_installed",
  "policy is not force_installed",
);
assert(settings.update_url === updatesUrl, "policy update_url is wrong");
assert(
  Array.isArray(settings.runtime_allowed_hosts) &&
    settings.runtime_allowed_hosts.length > 0,
  "policy grants no runtime hosts",
);

process.stdout.write(`packed-build selfcheck passed for ${id}\n`);
