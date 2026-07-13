import { describe, expect, it } from "vitest";
import { copy, sentenceText } from "./copy";

describe("copy", () => {
  it("pluralizes the live annunciator and appends this-tab temporaries", () => {
    expect(sentenceText(copy.annunciator.live(1, 1, 0))).toBe(
      "Live — 1 rule on 1 profile.",
    );
    expect(sentenceText(copy.annunciator.live(3, 2, 0))).toBe(
      "Live — 3 rules on 2 profiles.",
    );
    expect(sentenceText(copy.annunciator.live(3, 2, 1))).toBe(
      "Live — 3 rules on 2 profiles. · 1 temporary on this tab",
    );
  });

  it("names one site inline and counts the rest for needs-access", () => {
    expect(
      sentenceText(copy.annunciator.needsAccess(1, "app.acme.dev", 0)),
    ).toBe(
      "1 rule can't run — headershim doesn't have access to app.acme.dev.",
    );
    expect(
      sentenceText(copy.annunciator.needsAccess(2, "api.example.com", 2)),
    ).toBe(
      "2 rules can't run — headershim doesn't have access to api.example.com and 2 more sites.",
    );
  });

  it("marks hostnames and counts as data segments for the mono face", () => {
    const parts = copy.annunciator.needsAccess(2, "api.example.com", 2);
    expect(parts.filter((part) => typeof part !== "string")).toEqual([
      { data: "2" },
      { data: "api.example.com" },
      { data: "2" },
    ]);
  });

  it("builds host-bound toasts, grants, and errors", () => {
    expect(copy.toast.activeOn("api.example.com")).toBe(
      "Active on api.example.com",
    );
    expect(copy.toast.profileDeleted("QA roles")).toBe(
      "Profile 'QA roles' deleted",
    );
    expect(copy.actions.allowOn("3 sites")).toBe("Allow on 3 sites");
    expect(copy.emptyState.profile("Staging")).toBe("No rules in Staging yet.");
    expect(copy.grantPanel.single("api.example.com")).toContain(
      "To change headers on api.example.com",
    );
    expect(copy.grantPanel.multiple(3)).toContain("on 3 sites");
    expect(
      copy.grantPanel.initiator("app.example.com", "api.example.com"),
    ).toContain("the site you're on");
    expect(copy.errors.grantDeclined("api.example.com")).toContain(
      "You declined access to api.example.com",
    );
    expect(copy.errors.appendDisallowed("x-custom-token")).toContain(
      "x-custom-token isn't one of them",
    );
    expect(copy.errors.ruleCounter(4120)).toBe("4,120 of 4,500 enabled rules.");
    expect(copy.errors.importNewer(2, 1)).toContain(
      "format 2; this version reads up to 1",
    );
    // The Regenerate action renders as a button after the note, so the visible
    // reading stays "Frozen at save · … · Regenerate".
    expect(copy.generatedValue.frozen("2026-07-12 14:03 UTC")).toBe(
      "Frozen at save · 2026-07-12 14:03 UTC",
    );
    expect(copy.editor.suggestions(1)).toBe("1 suggestion");
    expect(copy.editor.suggestions(6)).toBe("6 suggestions");
    expect(sentenceText(copy.editor.savedAs("x-feature-override"))).toBe(
      "saved as x-feature-override",
    );
    expect(sentenceText(copy.editor.patternHint)).toBe(
      "||example.com^ matches the site and subdomains · *://*/api/* matches paths",
    );
    expect(copy.verify.summary(2, 3)).toBe(
      "2 of 3 rules matched on this tab · last 5 min",
    );
  });

  it("keeps the static canonical strings verbatim", () => {
    expect(sentenceText(copy.annunciator.paused)).toBe(
      "Paused — no headers are being modified.",
    );
    expect(sentenceText(copy.annunciator.off)).toBe(
      "Off — no profiles are on.",
    );
    expect(sentenceText(copy.annunciator.outOfSync)).toBe(
      "Out of sync — Chrome rejected headershim's last rule update, so the rules shown here may not all be applied. Any edit retries it.",
    );
    expect(copy.app.tagline).toBe(
      "Change HTTP headers on sites you choose. No account. Nothing ever leaves your device.",
    );
    expect(copy.errors.headerNotModifiable).toMatch(
      /^Header names starting with ':'/,
    );
    expect(copy.errors.storageBudget).toContain("safe budget of 4 MB");
    expect(copy.errors.regexRuleCap).toContain(
      "caps regex-scoped rules at 1,000",
    );
    expect(copy.errors.newerStore(2, 1)).toContain(
      "format 2; this version reads up to 1",
    );
    expect(copy.verify.limits).toContain('check "Disable cache"');
  });

  it("keeps the trust-page claims inside their honest wording bounds", () => {
    // The all-sites card quotes Chrome's real warning string and keeps the
    // revocation promise.
    expect(copy.options.siteAccess.allSites.body).toContain(
      '"Read and change all your data on all websites"',
    );
    expect(copy.options.siteAccess.allSites.body).toContain(
      "You can revoke it here at any time.",
    );
    // The install claim is always "no install-time warning" — never a broader
    // "no permission text anywhere" — and the build claim never says the store
    // build itself is verifiable.
    expect(copy.options.about.permissions.intro).toContain(
      "no install-time warning",
    );
    expect(copy.options.about.verifyBuild.caveat).toContain(
      "re-packages and signs",
    );
    expect(JSON.stringify(copy.options.about)).not.toMatch(
      /verify the store build/i,
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
    ).toBe("api.example.com grant removed — all-sites access still covers it");
  });
});
