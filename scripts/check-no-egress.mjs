import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// HeaderShim's core promise is that it makes zero network calls: no telemetry,
// no phone-home, no way to exfiltrate the rules (which can hold live tokens)
// out of the browser. Today that is a property of the source, not an enforced
// invariant — a future maintainer (or a hostile PR, the ModHeader-v2 takeover
// pattern) could add a `fetch()` and nothing would object. This gate turns the
// invariant into a build failure: any network-egress primitive in shipped code
// or in the built bundle stops the release.
//
// Two surfaces are scanned, both raw:
//   - src/ + entrypoints/ (authored, shipped code; tests excluded), so an
//     egress call is caught in review at the source line that introduced it.
//   - .output/chrome-mv3/**/*.js (the built bundle) — the artifact that
//     actually ships. This is the strongest signal: it includes everything
//     bundled from dependencies, after tree-shaking and minification.
//
// The patterns are call/`new`/URL-shaped so that identifiers that merely
// *mention* these words in prose or copy — a `sec-fetch-dest` header name, a
// `"XHR/fetch"` label, a `websockets: "WebSockets"` entry — never match; only a
// real call site does. The scan is deliberately raw and fail-safe: it errs
// toward flagging (a benign string that happened to contain, say, `fetch(`
// would break the build visibly and is trivially reworded) rather than toward
// parsing cleverness that could let an obfuscated call slip through. Computed
// or string-built access (`globalThis["fet"+"ch"]`) is out of scope for a
// static gate; the point is that the *direct, readable* way to add egress
// cannot land without ripping out this check.

const root = path.resolve(import.meta.dirname, "..");
const BUNDLE_DIR = path.join(root, ".output/chrome-mv3");

const RULES = [
  { name: "fetch", pattern: /\bfetch\s*\(/g, hint: "fetch() network call" },
  {
    name: "xhr",
    pattern: /\bnew\s+XMLHttpRequest\b|\bXMLHttpRequest\s*\(/g,
    hint: "XMLHttpRequest network client",
  },
  {
    name: "websocket",
    pattern: /\bnew\s+WebSocket\b|\bWebSocket\s*\(/g,
    hint: "WebSocket connection",
  },
  {
    name: "eventsource",
    pattern: /\bnew\s+EventSource\b|\bEventSource\s*\(/g,
    hint: "EventSource (server-sent events) connection",
  },
  {
    name: "sendbeacon",
    pattern: /\bsendBeacon\s*\(/g,
    hint: "navigator.sendBeacon() exfiltration primitive",
  },
  {
    name: "importscripts",
    pattern: /\bimportScripts\s*\(/g,
    hint: "importScripts() — loads and executes remote code in a worker",
  },
  {
    name: "image-beacon",
    pattern: /\bnew\s+Image\s*\(/g,
    hint: "new Image() — image-beacon exfiltration primitive",
  },
  {
    name: "remote-import",
    pattern: /\bimport\s*\(\s*[`'"]\s*https?:\/\//gi,
    hint: "dynamic import() of a remote URL",
  },
  {
    name: "remote-src",
    pattern: /\.src\s*=\s*[`'"]?\s*https?:\/\//gi,
    hint: "assignment of a remote URL to an element .src (script/img beacon)",
  },
  {
    name: "remote-setattribute",
    pattern: /setAttribute\s*\(\s*[`'"]src[`'"]\s*,\s*[`'"]?\s*https?:\/\//gi,
    hint: "setAttribute('src', <remote URL>) injection",
  },
  {
    name: "script-element",
    pattern: /createElement\s*\(\s*[`'"]script[`'"]/gi,
    hint: "createElement('script') — remote-code injection vector",
  },
];

function scan(label, filePath, text) {
  const lines = text.split("\n");
  return RULES.flatMap((rule) =>
    lines.flatMap((line, index) => {
      rule.pattern.lastIndex = 0;
      const found = rule.pattern.exec(line)?.[0]?.trim();
      return found === undefined
        ? []
        : `${label} ${filePath}:${index + 1}: [${rule.name}] "${found}" — ${rule.hint}`;
    }),
  );
}

function sourceFiles() {
  return execFileSync("git", ["ls-files", "src", "entrypoints"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file))
    .filter((file) => !/\.(?:test|spec)\.[tj]sx?$/.test(file));
}

function bundleFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return bundleFiles(full);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [full] : [];
  });
}

const violations = [];
let scanned = 0;

for (const file of sourceFiles()) {
  violations.push(
    ...scan("source", file, readFileSync(path.join(root, file), "utf8")),
  );
  scanned += 1;
}

if (!existsSync(BUNDLE_DIR)) {
  console.error(
    `No-egress check: ${BUNDLE_DIR} not found. Run \`pnpm build\` before this gate — the built bundle is the authoritative surface it scans.`,
  );
  process.exit(1);
}

for (const file of bundleFiles(BUNDLE_DIR)) {
  violations.push(
    ...scan("bundle", path.relative(root, file), readFileSync(file, "utf8")),
  );
  scanned += 1;
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  console.error(
    `\n${violations.length} network-egress violation(s). HeaderShim ships zero network calls by design; this is an enforced invariant, not a preference. If a network capability is genuinely required, that is a deliberate change to the extension's trust model and must be reviewed as such — it cannot be slipped in past this gate.`,
  );
  process.exit(1);
}

console.log(`No-egress check passed (${scanned} files scanned).`);
