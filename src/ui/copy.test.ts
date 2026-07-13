import { describe, expect, it } from "vitest";
import { copy } from "./copy";

describe("copy", () => {
  it("pluralizes the live annunciator and appends this-tab temporaries", () => {
    expect(copy.annunciator.live(1, 1, 0)).toBe("Live — 1 rule on 1 profile.");
    expect(copy.annunciator.live(3, 2, 0)).toBe(
      "Live — 3 rules on 2 profiles.",
    );
    expect(copy.annunciator.live(3, 2, 1)).toBe(
      "Live — 3 rules on 2 profiles. · 1 temporary on this tab",
    );
  });

  it("names one site inline and counts the rest for needs-access", () => {
    expect(copy.annunciator.needsAccess(1, "app.acme.dev", 0)).toBe(
      "1 rule can't run — headershim doesn't have access to app.acme.dev.",
    );
    expect(copy.annunciator.needsAccess(2, "api.example.com", 2)).toBe(
      "2 rules can't run — headershim doesn't have access to api.example.com and 2 more sites.",
    );
  });

  it("builds host-bound toasts, grants, and errors", () => {
    expect(copy.toast.activeOn("api.example.com")).toBe(
      "Active on api.example.com",
    );
    expect(copy.toast.profileDeleted("QA roles")).toBe(
      "Profile 'QA roles' deleted · Undo",
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
    expect(copy.generatedValue.frozen("2026-07-12 14:03 UTC")).toBe(
      "Frozen at save · 2026-07-12 14:03 UTC · Regenerate",
    );
    expect(copy.verify.summary(2, 3)).toBe(
      "2 of 3 rules matched on this tab · last 5 min",
    );
  });

  it("keeps the static canonical strings verbatim", () => {
    expect(copy.annunciator.paused).toBe(
      "Paused — no headers are being modified.",
    );
    expect(copy.annunciator.off).toBe("Off — no profiles are on.");
    expect(copy.app.tagline).toBe(
      "Change HTTP headers on sites you choose. No account. Nothing ever leaves your device.",
    );
    expect(copy.errors.headerNotModifiable).toMatch(
      /^Header names starting with ':'/,
    );
    expect(copy.verify.limits).toContain('check "Disable cache"');
  });
});
