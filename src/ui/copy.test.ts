import { describe, expect, it } from "vitest";
import { copy, sentenceText } from "./copy";

describe("copy", () => {
  it("names the enabled/configured split and appends this-tab temporaries", () => {
    expect(sentenceText(copy.annunciator.live(1, 1, 0))).toBe(
      "On · 1 of 1 rule enabled",
    );
    expect(sentenceText(copy.annunciator.live(2, 3, 0))).toBe(
      "On · 2 of 3 rules enabled",
    );
    expect(sentenceText(copy.annunciator.live(2, 3, 1))).toBe(
      "On · 2 of 3 rules enabled · 1 temporary on this tab",
    );
  });

  it("names one site inline and counts the rest for needs-access", () => {
    expect(
      sentenceText(copy.annunciator.needsAccess(1, "app.acme.dev", 0)),
    ).toBe("Needs access · 1 rule needs app.acme.dev");
    expect(
      sentenceText(copy.annunciator.needsAccess(2, "api.example.com", 2)),
    ).toBe("Needs access · 2 rules need api.example.com and 2 more sites");
  });

  it("keeps counts in sans prose and marks only the host as data", () => {
    const parts = copy.annunciator.needsAccess(2, "api.example.com", 2);
    expect(parts.filter((part) => typeof part !== "string")).toEqual([
      { data: "api.example.com" },
    ]);
    expect(
      copy.annunciator.live(2, 3, 1).every((part) => typeof part === "string"),
    ).toBe(true);
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
    expect(sentenceText(copy.verify.matchedHeadline(2))).toBe(
      "Last 5 minutes: 2 matched",
    );
    expect(
      sentenceText(copy.verify.blockedHeadline(1, "api.example.com", 0)),
    ).toBe("1 rule can't run. Needs access to api.example.com.");
    expect(
      sentenceText(copy.verify.blockedHeadline(2, "api.example.com", 2)),
    ).toBe(
      "2 rules can't run. Needs access to api.example.com and 2 more sites.",
    );
  });

  it("keeps the static canonical strings verbatim", () => {
    expect(sentenceText(copy.annunciator.paused)).toBe(
      "Paused · no headers are being modified",
    );
    expect(sentenceText(copy.annunciator.off)).toBe("Off · no profiles are on");
    expect(sentenceText(copy.annunciator.outOfSync)).toBe(
      "Out of sync · Chrome rejected the last rule update. Any edit retries it.",
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
    expect(copy.verify.noMatchesHeadline).toBe(
      "No matches in the last 5 minutes on this tab.",
    );
    expect(Object.keys(copy.verify).sort()).toEqual(
      ["blockedHeadline", "matchedHeadline", "noMatchesHeadline"].sort(),
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
