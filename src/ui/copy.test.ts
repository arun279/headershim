import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_SITES_ORIGIN, MANIFEST_PERMISSIONS } from "../core/grants";
import { MINIMUM_CHROME_VERSION } from "../core/limits";
import { copy, sentenceText } from "./copy";
import { copy as editorCopy } from "./copy.editor";
import { copy as optionsCopy, siteAccessCopy } from "./copy.options";

const privacyPolicy = readFileSync(
  new URL("../../PRIVACY.md", import.meta.url),
  "utf8",
);
const readme = readFileSync(
  new URL("../../README.md", import.meta.url),
  "utf8",
);

/** One About row read end to end: its lead sentence plus every detail under it. */
function permissionRow(name: string): string {
  const row = optionsCopy.options.about.permissions.items.find(
    (item) => item.name === name,
  );
  if (row === undefined) {
    throw new Error(`About discloses no ${name} permission`);
  }
  return [row.reason, ...row.details].join("\n");
}

// A representative, not exhaustive, denylist of header-extension competitors
// and notable extension incidents. "ModHeader" is the sole sanctioned name and
// is checked separately in expectHouseVoice.
const DENYLIST = [
  "requestly",
  "header editor",
  "simple modify headers",
  "modify header value",
  "the great suspender",
  "dataspii",
  "nano adblocker",
  "nano defender",
  "stylish",
  "hola",
];

/** The house voice rules, applied to one piece of copy a user can read. */
function expectHouseVoice(text: string): void {
  const lower = text.toLowerCase();
  expect(text, `em-dash in: ${text}`).not.toMatch(/[–—]/);
  expect(text, `spaced-hyphen separator in: ${text}`).not.toContain(" - ");
  expect(text, `exclamation mark in: ${text}`).not.toContain("!");
  expect(text, `emoji in: ${text}`).not.toMatch(/\p{Extended_Pictographic}/u);
  // A forward promise binds every future version; copy describes the one that
  // is installed. Rewrite into a present-tense, checkable statement.
  expect(lower, `forward promise in: ${text}`).not.toMatch(
    /\b(never|always|forever)\b/,
  );
  expect(lower, `apology-as-decoration in: ${text}`).not.toMatch(/oops|uh-oh/);
  for (const name of DENYLIST) {
    expect(
      lower,
      `competitor/incident name "${name}" in: ${text}`,
    ).not.toContain(name);
  }
  // ModHeader is allowed only as an import/export format label.
  if (lower.includes("modheader")) {
    expect(lower, `ModHeader outside import context: ${text}`).toMatch(
      /import|export/,
    );
  }
}

describe("copy", () => {
  it("answers the tab-scoped question and counts only exceptions", () => {
    expect(sentenceText(copy.readout.status(1, 1, false))).toBe(
      "1 change on this tab",
    );
    expect(sentenceText(copy.readout.status(2, 4, false))).toBe(
      "2 of 4 changes running on this tab",
    );
    expect(sentenceText(copy.readout.status(2, 4, true))).toBe(
      "2 of 4 changes held on this tab",
    );
    expect(copy.readout.needsAccess(2)).toBe("2 more need access");
    expect(copy.readout.overridden(1)).toBe(
      "1 more is overridden by another rule",
    );
    expect(copy.readout.refused(3)).toBe("3 more need attention");
    // The transport count names the caveat that set these changes apart, not
    // the working half every member shares; what each one does on HTTP/2
    // differs per header and is carried by that change's own line.
    expect(copy.readout.transport(1)).toBe(
      "1 more depends on the connection or its value",
    );
    expect(copy.readout.transport(3)).toBe(
      "3 more depend on the connection or their value",
    );
    // The count phrase must say what the state means on its own, not a
    // bare "unconfirmed".
    expect(copy.readout.unconfirmed(2)).toBe("Includes 2 decided per request");
    expect(copy.readout.overriddenBy("staging")).toBe("overridden by staging");
    expect(copy.readout.needsAccessReason(true)).toBe(
      "Not running. Grant access to run it on this tab.",
    );
  });

  it("keeps the token honest: a countdown only when it can read one", () => {
    expect(copy.token.expiresIn(0)).toBe("expired");
    expect(copy.token.expiresIn(5 * 3_600_000 + 18 * 60_000)).toBe(
      "expires in 5h 18m",
    );
    expect(copy.token.expiresIn(8 * 60_000)).toBe("expires in 8m");
    expect(copy.token.opaque).toBe("opaque token · no expiry to read");
  });

  it("names every site a commit will ask Chrome for, not a count", () => {
    expect(editorCopy.actions.andSites(["api.example.com"])).toBe(
      "api.example.com",
    );
    expect(
      editorCopy.actions.andSites(["api.example.com", "example.com"]),
    ).toBe("api.example.com and example.com");
    expect(editorCopy.actions.andSites(["a.test", "b.test", "c.test"])).toBe(
      "a.test, b.test and c.test",
    );
  });

  it("builds host-bound toasts, grants, and errors", () => {
    expect(copy.toast.profileDeleted("QA roles")).toBe(
      "Profile 'QA roles' deleted",
    );
    expect(copy.toast.lastProfileDeleted("Only")).toBe(
      "Profile 'Only' deleted; a new empty Default replaces it",
    );
    expect(editorCopy.actions.createRuleAndAllow("api.example.com")).toBe(
      "Create rule and allow api.example.com",
    );
    expect(copy.readout.addThisTabAndAllow("api.example.com")).toBe(
      "Add and allow api.example.com",
    );
    expect(editorCopy.actions.saveChangesAndAllow("api.example.com")).toBe(
      "Save changes and allow api.example.com",
    );
    expect(copy.errors.grantDeclined("api.example.com")).toContain(
      "You declined access to api.example.com",
    );
    expect(copy.errors.grantDeclined("api.example.com")).not.toContain(
      "starts working immediately",
    );
    expect(copy.errors.appendDisallowed("x-custom-token")).toContain(
      "x-custom-token isn't one of them",
    );
    expect(copy.errors.ruleCounter(2120)).toBe("2,120 of 4,500 enabled rules.");
    expect(copy.errors.importNewer(2, 1)).toContain(
      "format 2; this version reads up to 1",
    );
    // Formats the freeze instant to the minute in UTC; the Regenerate action
    // renders as a button after it, so the reading is "Frozen at … · Regenerate".
    expect(editorCopy.valueNote.frozen("2026-07-12T14:03:27.000Z")).toBe(
      "Frozen at 2026-07-12 14:03 UTC. This exact value is used every time, not regenerated.",
    );
    expect(editorCopy.editor.suggestions(1)).toBe("1 suggestion");
    expect(editorCopy.editor.suggestions(6)).toBe("6 suggestions");
    expect(sentenceText(editorCopy.editor.savedAs("x-feature-override"))).toBe(
      "saved as x-feature-override",
    );
  });

  it("keeps the static canonical strings verbatim", () => {
    // The host sentence has one home: the editor advisory, which the popup
    // reason (transportNote) also reads, so the two surfaces cannot state
    // different truths about the Host header.
    expect(copy.advisories.host).toBe(
      "Rewrites the Host header on HTTP/1.1. On HTTP/2 Chrome keeps the real authority, so the change has nothing to act on there.",
    );
    // The transport sentences, verbatim. Each names the transport and states
    // the measured wire behavior of its family, and nothing more: h1-only
    // members arrive on HTTP/1.1 and are absent on HTTP/2; h2-breaking members
    // arrive on HTTP/1.1 and fail requests on HTTP/2; te and content-length
    // carry the value conditions under which HTTP/2 lets them through.
    expect(copy.advisories.h1Only).toBe(
      "Takes effect on HTTP/1.1 only; HTTP/2 has no such header and drops the change.",
    );
    expect(copy.advisories.h2Breaking).toBe(
      "Takes effect on HTTP/1.1; on HTTP/2 this header makes requests fail.",
    );
    expect(copy.advisories.te).toBe(
      "HTTP/2 allows te only as trailers; any other value makes requests fail there. HTTP/1.1 sends it as written.",
    );
    expect(copy.advisories.contentLength).toBe(
      "Sent as written on HTTP/1.1, even when it contradicts the body. On HTTP/2, requests fail when it does.",
    );
    // Names the control the footer actually has, not a "Resume" that never
    // appears on any surface.
    expect(copy.readout.pausedBanner).toBe(
      "Everything paused. Switching back on restores this exact state.",
    );
    expect(copy.errors.headerNotModifiable).toMatch(
      /^Header names starting with ':'/,
    );
    expect(copy.errors.storageBudget).toContain("safe budget of 4 MB");
    expect(copy.errors.regexRuleCap).toContain(
      "caps regex-scoped rules at 1,000",
    );
    expect(copy.profiles.nameTaken("Staging")).toBe(
      "'Staging' is taken. Use a different name.",
    );
    expect(optionsCopy.options.settings.eraseAll).toEqual({
      action: "Start over",
      confirmTitle: "Start over?",
      confirmBody:
        "This replaces your configuration with a new empty Default profile and default settings, revokes all site access, and clears any This-tab overrides. Undo restores only the configuration, not site access or This-tab overrides.",
      done: "Configuration replaced",
    });
    // One canonical label per state across the popup and the options
    // Active-changes surface: no per-surface drift.
    expect(optionsCopy.options.traffic.status.unconfirmed).toBe(
      "decided per request",
    );
    expect(optionsCopy.options.traffic.status.needsAccess).toBe("needs access");
    expect(copy.readout.unconfirmed(3)).toContain(
      optionsCopy.options.traffic.status.unconfirmed,
    );
    // The tape's caveat words, one per family in the same lowercase register.
    // te and content-length each get their own: "breaks on HTTP/2" is false
    // for te's one allowed value, and false for a content-length that agrees
    // with the body, so both name their condition instead of the failure.
    expect(optionsCopy.options.traffic.caveat.h1Only).toBe("HTTP/1.1 only");
    expect(optionsCopy.options.traffic.caveat.h2Breaking).toBe(
      "breaks on HTTP/2",
    );
    expect(optionsCopy.options.traffic.caveat.te).toBe(
      "trailers only on HTTP/2",
    );
    expect(optionsCopy.options.traffic.caveat.contentLength).toBe(
      "mismatch breaks HTTP/2",
    );
    // The per-line reason stays the honest sentence that never presumes a match.
    expect(copy.readout.unconfirmedReason).toBe(
      "Whether this runs is decided per request",
    );
    expect(copy.errors.newerStore(2, 1)).toContain(
      "format 2; this version reads up to 1",
    );
    expect(copy.errors.eraseFailed).toBe(
      "Couldn't finish erasing. Check Site access and This tab, then try again.",
    );
    expect(copy.errors.unavailable).toBe(
      "Couldn't load saved state. Reload the extension from chrome://extensions and try again.",
    );
  });

  it("keeps README manifest facts aligned with their constants", () => {
    expect(readme).toContain(`Chrome ${MINIMUM_CHROME_VERSION} or later`);
    expect(readme).toContain(
      `The manifest declares ${MANIFEST_PERMISSIONS.map((name) => `\`${name}\``)
        .join(", ")
        .replace(/, ([^,]+)$/, ", and $1")}.`,
    );
    expect(readme).toContain(`request up to \`${ALL_SITES_ORIGIN}\``);
  });

  it("keeps About factual and site-access wording precise", () => {
    expect(siteAccessCopy.allSites.warning).toContain(
      '"Read and change all your data on all websites"',
    );
    expect(siteAccessCopy.allSites.warning).toContain(
      "you can revoke this access here at any time.",
    );
    expect(optionsCopy.options.about).not.toHaveProperty("theme");
    expect(
      sentenceText(optionsCopy.options.about.build("1.2.0", "a1b2c3d")),
    ).toBe("HeaderShim v1.2.0 · commit a1b2c3d");
    expect(optionsCopy.options.about.description).not.toContain("ModHeader");
    expect(optionsCopy.options.importExport.instruction).toContain(
      "ModHeader export",
    );
    expect(optionsCopy.options.about.license).toBe(
      "Open source under the MIT license. Provided as is, without warranty.",
    );
    expect(optionsCopy.options.settings.theme.label).toBe("Theme");
    expect(Object.keys(optionsCopy.options.about).sort()).toEqual(
      [
        "build",
        "description",
        "license",
        "links",
        "permissions",
        "title",
      ].sort(),
    );
    expect(siteAccessCopy.usageLead("none")).toBe("Needed by");
    expect(siteAccessCopy.usageLead("partial")).toBe("Used by");
    expect(siteAccessCopy.usageLead("full")).toBe("Used by");
    expect(siteAccessCopy.partialHeading).toBe("Limited access");
    expect(siteAccessCopy.guidance).toContain(
      "Add rules in the popup or rule editor, and this-tab changes in the popup.",
    );
    expect(siteAccessCopy.guidance).toContain("Grant access there or here.");
    expect(siteAccessCopy.guidance).toContain(
      "Chrome's controls can also add, limit, or remove access.",
    );
    expect(
      sentenceText(siteAccessCopy.partial(["https://*.api.example.com/*"])),
    ).toContain("Covers only https://*.api.example.com");
    expect(
      sentenceText(
        siteAccessCopy.partial([
          "https://api.example.com/*",
          "http://api.example.com/*",
        ]),
      ),
    ).toContain(
      "Covers only https://api.example.com and http://api.example.com",
    );
    expect(
      sentenceText(siteAccessCopy.partial(["one", "two", "three"])),
    ).toContain("one, two and three");
    expect(
      sentenceText(
        siteAccessCopy.partial(["one", "two", "three", "four", "five", "six"]),
      ),
    ).toContain("one, two, three, four, five and six");
    expect(copy.readout.grantAllSites).toBe(siteAccessCopy.allSites.button);
    expect(siteAccessCopy.ruleCount(2)).toBe("2 rules");
    expect(siteAccessCopy.tabCount(1)).toBe("1 tab change");
    expect(siteAccessCopy.revoked("api.example.com")).toBe(
      "No direct grant for api.example.com",
    );
    expect(siteAccessCopy.notGranted("api.example.com")).toBe(
      "Access to api.example.com was not granted",
    );
    expect(siteAccessCopy.revokeFailed("api.example.com")).toBe(
      "Site grant for api.example.com could not be removed",
    );
    expect(siteAccessCopy.allSites.revoke).toBe("Revoke all-sites access");
    expect(siteAccessCopy.notBroadened("api.example.com")).toBe(
      "Access to api.example.com was not broadened",
    );
  });

  // The About rows are the source of the long disclosure and PRIVACY.md is the
  // same disclosure read end to end, so the expectation is taken from the About
  // rows rather than typed out a third time here: reword one surface alone and
  // this goes red, reword both together and it stays green. PRIVACY.md is free
  // to add to what it carries, which is where the platform's own names for the
  // storage areas live.
  it("carries every About permission sentence in the privacy policy verbatim", () => {
    for (const item of optionsCopy.options.about.permissions.items) {
      for (const text of [item.reason, ...item.details]) {
        expect(
          privacyPolicy,
          `the privacy policy does not carry, in these words: ${text}`,
        ).toContain(text);
      }
    }
  });

  // The About permissions card states the two facts that matter while a
  // credential is in the clipboard, and the export hint carries the same
  // credentials-file warning: the in-product disclosure lives where a user
  // deciding whether to trust the extension reads it.
  it("carries the shared data facts on the About card and the export hint", () => {
    const aboutStorage = permissionRow("storage");
    const aboutRulesEngine = permissionRow(
      "declarativeNetRequestWithHostAccess",
    );

    expect(aboutStorage).toContain("stored on this device without encryption");
    expect(aboutRulesEngine).toContain("to every site it matches");

    expect(optionsCopy.options.importExport.secretsReminder).toContain(
      "Treat it like a credentials file.",
    );
    expect(aboutStorage).toContain("Treat it like a credentials file.");
  });

  // The About page links the privacy policy, so it is product copy reached from
  // the product and holds the same voice rules as the strings below.
  it("holds the copy voice rules in the privacy policy too", () => {
    for (const line of privacyPolicy.split("\n")) {
      expectHouseVoice(line);
    }
  });

  // A global guard on the copy voice rules, so a new string can't ship an
  // exclamation, emoji, apology-as-decoration, forward promise, or a
  // competitor/vendor/incident name without a test going red. Function-valued
  // copy is resolved with sample args of every shape to reach its branches.
  it("holds the copy voice and naming invariants for every reachable string", () => {
    const sampleArgs: readonly unknown[][] = [
      ["api.example.com", 2, 1],
      [2, "api.example.com", 1],
      [4120, 4500],
      [1, 1, 0],
      [3, 2, 1],
      ["QA roles"],
      ["x-custom-token"],
      ["2026-07-12 14:03 UTC"],
      [true, true],
      [false, false],
      [1],
      [0],
    ];

    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") {
        strings.push(value);
      } else if (Array.isArray(value)) {
        for (const part of value) {
          if (part !== null && typeof part === "object" && "data" in part) {
            collect((part as { data: unknown }).data);
          } else {
            collect(part);
          }
        }
      } else if (typeof value === "function") {
        for (const args of sampleArgs) {
          try {
            collect((value as (...a: unknown[]) => unknown)(...args));
          } catch {
            // A sample tuple that doesn't fit this signature; another will.
          }
        }
      } else if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) {
          collect(child);
        }
      }
    };
    collect(copy);
    collect(optionsCopy);
    collect(editorCopy);

    expect(strings.length).toBeGreaterThan(100);
    for (const text of strings) {
      expectHouseVoice(text);
    }
  });
});
