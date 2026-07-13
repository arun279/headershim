import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Packs the built extension into a signed CRX so it can be force-installed
// through an enterprise policy — the only way to reach the packed/store code
// path that the unpacked harness cannot. The signing key is generated once and
// kept out of version control; the extension id is derived from it so the
// managed-policy install and the local update manifest agree on one id.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const artifactsDir = path.join(here, ".artifacts");
export const keyPath = path.join(artifactsDir, "signing-key.pem");
export const crxPath = path.join(artifactsDir, "headershim.crx");
export const idPath = path.join(artifactsDir, "extension-id.txt");
const builtExtension = path.join(root, ".output", "chrome-mv3");

// An extension id is the first 128 bits of the SHA-256 of the public key's
// SubjectPublicKeyInfo, rendered as 32 mpdecimal digits (0-f mapped to a-p).
export function extensionIdForKey(privateKeyPem) {
  const spki = createPublicKey(privateKeyPem).export({
    type: "spki",
    format: "der",
  });
  const digest = createHash("sha256").update(spki).digest();
  let id = "";
  for (const byte of digest.subarray(0, 16)) {
    id += "abcdefghijklmnop"[byte >> 4] + "abcdefghijklmnop"[byte & 0xf];
  }
  return id;
}

function ensureKey() {
  if (existsSync(keyPath)) {
    return readFileSync(keyPath, "utf8");
  }
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(keyPath, pem, { mode: 0o600 });
  return pem;
}

export function pack() {
  if (!existsSync(builtExtension)) {
    throw new Error(
      `Built extension not found at ${builtExtension}; run "pnpm build" first.`,
    );
  }
  const keyPem = ensureKey();
  const id = extensionIdForKey(keyPem);

  // --pack-extension writes "<dir>.crx" next to a copy of the source so the
  // committed build output stays untouched; it needs a throwaway profile dir to
  // avoid reading the machine profile.
  const work = mkdtempSync(path.join(tmpdir(), "headershim-pack-"));
  const source = path.join(work, "chrome-mv3");
  cpSync(builtExtension, source, { recursive: true });
  try {
    execFileSync(
      chromium.executablePath(),
      [
        `--pack-extension=${source}`,
        `--pack-extension-key=${keyPath}`,
        `--user-data-dir=${path.join(work, "profile")}`,
        "--no-sandbox",
      ],
      { stdio: "inherit" },
    );
    mkdirSync(artifactsDir, { recursive: true });
    renameSync(`${source}.crx`, crxPath);
    writeFileSync(idPath, id);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { id, crxPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { id } = pack();
  process.stdout.write(`${id}\n`);
}
