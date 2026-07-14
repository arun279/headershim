import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// HeaderShim's core promise is that it makes zero network calls: no telemetry,
// no phone-home, no way to exfiltrate the rules (which can hold live tokens)
// out of the browser. Today that is a property of the source, not an enforced
// invariant — a future maintainer (or a hostile PR, the ModHeader-v2 takeover
// pattern) could add a `fetch()` and nothing would object. This gate turns the
// invariant into a build failure.
//
// Two surfaces are scanned, both raw:
//   - src/ + entrypoints/ (authored, shipped code; tests excluded), so a leak
//     is caught in review at the source line that introduced it.
//   - .output/chrome-mv3/**/{.js,.css,.html} (the built artifact that ships) —
//     the strongest signal: it includes everything bundled from dependencies,
//     after tree-shaking and minification.
//
// The invariant has two halves:
//   1. No script-driven egress: fetch/XHR/WebSocket/EventSource/sendBeacon/
//      importScripts/new Image()/createElement('script'). These call-shaped
//      patterns also catch egress to a *variable* URL that a literal scan
//      can't see. Identifiers that merely mention these words in prose or copy
//      (a `sec-fetch-dest` header name, a `"XHR/fetch"` label) don't match;
//      only a real call site does.
//   2. No auto-loaded remote resource: an `<img src>`, `<link href>`, remote
//      font, CSS `url()`, or remote `import()` reaches the network under MV3's
//      default CSP even though it isn't a scripted call. Rather than enumerate
//      every resource context, the gate flags *every* remote URL literal in
//      shipped code and allows only an explicit few (see ALLOWED_REMOTE_URLS).
//      User-clickable repo links (the About page's `<a href>`) are on that
//      list; a shipped resource that auto-loads from anywhere else is not.
//
// The scan is deliberately raw and fail-safe: it errs toward flagging (a benign
// string that happened to contain `fetch(`, or a new remote URL, breaks the
// build visibly and is trivially triaged) rather than toward parsing cleverness
// that could let an obfuscated leak slip through. Computed/string-built access
// (`globalThis["fet"+"ch"]`, a URL assembled at runtime) is out of scope for a
// static gate; the point is that the direct, readable way to add egress cannot
// land without ripping out this check.

const root = path.resolve(import.meta.dirname, "..");
const BUNDLE_DIR = path.join(root, ".output/chrome-mv3");

// The only remote URLs any shipped file is allowed to contain. These are the
// About page's repository links (defined in src/ui/copy.ts and rendered as
// user-clickable `<a href>` anchors, never auto-loaded). Matched in full, so a
// secret appended as a path or query (`.../releases?leak=…`) is a different
// token and still fails.
const ALLOWED_REMOTE_URLS = new Set([
  "https://github.com/arun279/headershim",
  "https://github.com/arun279/headershim/issues",
  "https://github.com/arun279/headershim/releases",
]);

function isAllowedRemoteUrl(url) {
  // W3C XML namespace URIs (SVG/MathML/XHTML) are identifiers the renderer
  // never fetches; Preact emits them via createElementNS in the bundle.
  return url.startsWith("http://www.w3.org/") || ALLOWED_REMOTE_URLS.has(url);
}

// A remote URL literal: from the scheme up to the first delimiter that ends a
// string, attribute, CSS value, or JSX expression.
const REMOTE_URL = /https?:\/\/[^\s"'`)<>\]}]+/g;

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
    name: "script-element",
    pattern: /createElement\s*\(\s*[`'"]script[`'"]/gi,
    hint: "createElement('script') — remote-code injection vector",
  },
  {
    // Protocol-relative resource URL (`url(//host…)`, `src="//host…"`).
    // Restricted to a quote/paren context so JS `//` comments never match.
    name: "protocol-relative-url",
    pattern: /url\(\s*['"]?\/\/[a-z0-9-]+\.|['"]\/\/[a-z0-9-]+\.[a-z]/gi,
    hint: "protocol-relative remote resource URL",
  },
];

function scan(label, filePath, text) {
  const lines = text.split("\n");
  const ruleHits = RULES.flatMap((rule) =>
    lines.flatMap((line, index) => {
      rule.pattern.lastIndex = 0;
      const found = rule.pattern.exec(line)?.[0]?.trim();
      return found === undefined
        ? []
        : `${label} ${filePath}:${index + 1}: [${rule.name}] "${found}" — ${rule.hint}`;
    }),
  );
  const urlHits = lines.flatMap((line, index) =>
    [...line.matchAll(REMOTE_URL)]
      .map((match) => match[0])
      .filter((url) => !isAllowedRemoteUrl(url))
      .map(
        (url) =>
          `${label} ${filePath}:${index + 1}: [remote-url] "${url}" — remote URL in shipped code auto-loads over the network; only the About-page repository links are allowed`,
      ),
  );
  return [...ruleHits, ...urlHits];
}

const SCANNED_EXTENSIONS = /\.(?:ts|tsx|js|mjs|css|html)$/;

function sourceFiles() {
  return execFileSync("git", ["ls-files", "src", "entrypoints"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => SCANNED_EXTENSIONS.test(file))
    .filter((file) => !/\.(?:test|spec)\.[tj]sx?$/.test(file));
}

function bundleFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return bundleFiles(full);
    }
    return entry.isFile() && /\.(?:js|css|html)$/.test(entry.name)
      ? [full]
      : [];
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
