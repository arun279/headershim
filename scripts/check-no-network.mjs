import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// PRIVACY.md states two separate facts about the shipped package.
// manifest-policy.mjs holds the first one: connect-src 'none' is
// browser-enforced, and it closes fetch, XMLHttpRequest, WebSocket,
// EventSource, and sendBeacon for the extension's own pages and worker. The
// second one is a claim about the built files, that they carry no call site for
// any of them, and a claim published in a privacy policy is worth a check: a
// fetch( added later would falsify it silently. Nothing the bundle reaches calls
// one, and the one call the bundler would have added on its own is off:
// wxt.config.ts drops Vite's modulePreload polyfill, whose warm-up fetch is the
// only fetch() the bundle would otherwise contain. The e2e harness does call
// fetch, from the test process and the page it drives rather than from the
// package, which is one reason this reads the build output and not the repo.
//
// What this covers, and what the copy it backs may therefore claim: a call
// written as the name followed by `(`. An indirect call through a variable or a
// computed property is not covered, and neither is any other way a page can
// reach the network (an <img> src, a form action, window.open, a location
// assignment, a prefetch link), which is why PRIVACY.md states the scan's scope
// rather than treating it as proof that nothing leaves.

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, ".output/chrome-mv3");

const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".html", ".css", ".json"]);

// Every name is matched in call shape, and as the identifier it is, which is
// case-sensitive. Several of these names also ship as data, so a bare-identifier
// match reports the data rather than the fact being checked: the built package
// carries `xmlhttprequest` and `websocket` as declarativeNetRequest
// ResourceType literals, `XHR/fetch` and `WebSockets` as resource-type picker
// labels, and `sec-fetch-dest`/`sec-fetch-mode` as header names the rule editor
// offers. Requiring the `(` is what makes a hit a call site; matching case is
// what keeps the scan on identifiers rather than on the lowercase spellings of
// those literals.
const PRIMITIVES = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "RTCPeerConnection",
  "importScripts",
].map((name) => new RegExp(String.raw`\b${name}\s*\(`));

function scannedFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return scannedFiles(full);
    }
    return SCANNED_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

const violations = [];
for (const file of scannedFiles(outDir)) {
  const source = readFileSync(file, "utf8");
  for (const pattern of PRIMITIVES) {
    const match = pattern.exec(source);
    if (match !== null) {
      // A bundled chunk is one long line, so the offset is what locates the hit;
      // the line number is what the other checks print, and both are given.
      const offset = match.index;
      const line = source.slice(0, offset).split("\n").length;
      const around = source
        .slice(Math.max(0, offset - 60), offset + 60)
        .replace(/\s+/g, " ");
      violations.push(
        `${path.relative(root, file)}:${line}: ${match[0]} at offset ${offset} in ...${around}...`,
      );
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  console.error(
    `\n${violations.length} network call site(s) in the built extension. PRIVACY.md states that it contains none of these seven; change the code or change what it says.`,
  );
  process.exit(1);
}

console.log("No-network check passed.");
