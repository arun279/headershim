import { describe, expect, it } from "vitest";
import { copy, sentenceText } from "./copy";

describe("copy", () => {
  it("answers the tab-scoped question and counts only exceptions", () => {
    expect(sentenceText(copy.readout.status(1))).toBe("1 change on this tab");
    expect(sentenceText(copy.readout.status(4))).toBe("4 changes on this tab");
    expect(copy.readout.needsAccess(2)).toBe("2 needs access");
    expect(copy.readout.overridden(1)).toBe("1 overridden by another rule");
    expect(copy.readout.refused(3)).toBe("3 refused by Chrome");
    expect(copy.readout.overriddenBy("Staging auth")).toBe(
      "overridden by Staging auth",
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

  it("builds host-bound toasts, grants, and errors", () => {
    expect(copy.toast.activeOn("api.example.com")).toBe(
      "Active on api.example.com",
    );
    expect(copy.toast.profileDeleted("QA roles")).toBe(
      "Profile 'QA roles' deleted",
    );
    expect(copy.actions.createRuleAndAllow("api.example.com")).toBe(
      "Create rule and allow api.example.com",
    );
    expect(copy.actions.saveChangesAndAllow("api.example.com")).toBe(
      "Save changes and allow api.example.com",
    );
    expect(copy.emptyState.profile("Staging")).toBe(
      "Staging has no rules yet.",
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
    expect(copy.errors.ruleCounter(4120)).toBe("4,120 of 4,500 enabled rules.");
    expect(copy.errors.importNewer(2, 1)).toContain(
      "format 2; this version reads up to 1",
    );
    // The Regenerate action renders as a button after the note, so the visible
    // reading stays "Frozen at save: … · Regenerate".
    expect(copy.generatedValue.frozen("2026-07-12 14:03 UTC")).toBe(
      "Frozen at save: 2026-07-12 14:03 UTC",
    );
    expect(copy.editor.suggestions(1)).toBe("1 suggestion");
    expect(copy.editor.suggestions(6)).toBe("6 suggestions");
    expect(sentenceText(copy.editor.savedAs("x-feature-override"))).toBe(
      "saved as x-feature-override",
    );
    expect(sentenceText(copy.editor.patternHint)).toBe(
      "||example.com/ matches the site, subdomains, and every path · ||example.com/api/ narrows it to /api/ paths",
    );
  });

  it("keeps the static canonical strings verbatim", () => {
    expect(copy.readout.refusedReason.host).toBe(
      "Chrome won't let extensions change the Host header",
    );
    // Names the control the footer actually has, not a "Resume" that never
    // appears on any surface.
    expect(copy.readout.pausedBanner).toBe(
      "Everything paused. Switching back on restores this exact state.",
    );
    expect(copy.app.tagline).toBe(
      "Add, change, and remove HTTP headers on the sites you choose.",
    );
    expect(copy.errors.headerNotModifiable).toMatch(
      /^Header names starting with ':'/,
    );
    expect(copy.errors.storageBudget).toContain("safe budget of 4 MB");
    expect(copy.errors.regexRuleCap).toContain(
      "caps regex-scoped rules at 1,000",
    );
    expect(copy.options.profiles.nameTaken("Staging")).toBe(
      "'Staging' is taken. Use a different name.",
    );
    expect(copy.errors.newerStore(2, 1)).toContain(
      "format 2; this version reads up to 1",
    );
  });

  it("keeps About factual and site-access wording precise", () => {
    expect(copy.options.siteAccess.allSites.warning).toContain(
      '"Read and change all your data on all websites"',
    );
    expect(copy.options.siteAccess.allSites.warning).toContain(
      "you can revoke this access here at any time.",
    );
    expect(copy.options.about).not.toHaveProperty("theme");
    expect(sentenceText(copy.options.about.build("1.2.0", "a1b2c3d"))).toBe(
      "HeaderShim v1.2.0 · commit a1b2c3d",
    );
    expect(copy.options.about.description).not.toContain("ModHeader");
    expect(copy.options.importExport.instruction).toContain("ModHeader export");
    expect(copy.options.about.license).toBe(
      "Open source under the MIT license. Provided as is, without warranty.",
    );
    expect(copy.options.settings.theme.label).toBe("Theme");
    expect(Object.keys(copy.options.about).sort()).toEqual(
      ["build", "description", "license", "links", "title"].sort(),
    );
    expect(copy.options.siteAccess.usedBy(1)).toBe("used by 1 rule");
    expect(copy.options.siteAccess.ruleCount(2)).toBe("2 rules");
    expect(copy.options.siteAccess.revoked("api.example.com")).toBe(
      "Access to api.example.com revoked",
    );
    // While the broad grant stands, removing a narrow grant must not claim
    // access ended.
    expect(
      copy.options.siteAccess.revokedUnderAllSites("api.example.com"),
    ).toBe("api.example.com grant removed. All-sites access still covers it.");
  });

  // A global guard on the copy voice rules and the naming denylist below, so
  // a new string can't ship an exclamation, emoji, apology-as-decoration, or a
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

    // A representative, not exhaustive, denylist of header-extension
    // competitors and notable extension incidents. "ModHeader" is the sole
    // sanctioned name and is checked separately below.
    const denylist = [
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

    expect(strings.length).toBeGreaterThan(100);
    for (const text of strings) {
      const lower = text.toLowerCase();
      expect(text, `em-dash in: ${text}`).not.toMatch(/[–—]/);
      expect(text, `spaced-hyphen separator in: ${text}`).not.toContain(" - ");
      expect(text, `exclamation mark in: ${text}`).not.toContain("!");
      expect(text, `emoji in: ${text}`).not.toMatch(
        /\p{Extended_Pictographic}/u,
      );
      expect(lower, `apology-as-decoration in: ${text}`).not.toMatch(
        /oops|uh-oh/,
      );
      for (const name of denylist) {
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
  });
});
