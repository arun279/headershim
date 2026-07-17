import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Profile, RuleDraft } from "../model";
import { err, ok } from "../result";
import { detectImportFormat } from "./detect";
import type { ImportPlan } from "./headershim";
import {
  importModHeader,
  type ModHeaderImportWarning,
  nearestBadgeColor,
  type RegexValidator,
} from "./modheader";

const PROFILE_URL = new URL(
  "./__fixtures__/modheader-profile.json",
  import.meta.url,
);
const INVALID_REGEX_URL = new URL(
  "./__fixtures__/modheader-invalid-regex.json",
  import.meta.url,
);

const acceptRegex: RegexValidator = async () => ok(undefined);

async function importFixture(
  fixture = PROFILE_URL,
  validateRegex = acceptRegex,
  existingProfiles: readonly Profile[] = [],
): Promise<ImportPlan<ModHeaderImportWarning>> {
  const result = await importModHeader(
    readFileSync(fixture, "utf8"),
    existingProfiles,
    validateRegex,
  );
  if (!result.ok) {
    throw new Error(`fixture import failed: ${result.error.kind}`);
  }
  return result.value;
}

function onlyProfile(plan: ImportPlan<ModHeaderImportWarning>) {
  const profile = plan.profiles[0];
  if (profile === undefined) {
    throw new Error("fixture must contain a profile");
  }
  return profile;
}

function ruleWithComment(
  plan: ImportPlan<ModHeaderImportWarning>,
  comment: string,
): RuleDraft {
  const rule = onlyProfile(plan).rules.find(
    (candidate) => candidate.comment === comment,
  );
  if (rule === undefined) {
    throw new Error(`fixture must contain ${comment}`);
  }
  return rule;
}

function warningsOfKind<Kind extends ModHeaderImportWarning["kind"]>(
  plan: ImportPlan<ModHeaderImportWarning>,
  kind: Kind,
): Extract<ModHeaderImportWarning, { kind: Kind }>[] {
  return plan.warnings.filter(
    (warning): warning is Extract<ModHeaderImportWarning, { kind: Kind }> =>
      warning.kind === kind,
  );
}

describe("ModHeader import", () => {
  it("maps profile title, short title, and nearest badge color", async () => {
    const profile = onlyProfile(await importFixture());

    expect(profile).toMatchObject({
      name: "Development",
      badgeText: "DE",
      color: "blue",
    });
    expect(profile).not.toHaveProperty("enabled");
    expect(nearestBadgeColor("#b03a78")).toBe("magenta");
    expect(nearestBadgeColor("#fff")).toBe("plum");
    expect(nearestBadgeColor(undefined)).toBe("indigo");
  });

  it("maps request headers and degrades unsupported append operations", async () => {
    const plan = await importFixture();

    expect(ruleWithComment(plan, "accepted response formats")).toMatchObject({
      direction: "request",
      operation: "append",
      header: "accept",
      value: "application/json",
      enabled: true,
    });
    expect(ruleWithComment(plan, "debug switch")).toMatchObject({
      direction: "request",
      operation: "set",
      header: "x-debug",
      value: "on",
      enabled: false,
    });
    expect(warningsOfKind(plan, "request-append-degraded")).toEqual([
      {
        kind: "request-append-degraded",
        ruleName: "debug switch",
        header: "x-debug",
      },
    ]);
  });

  it("maps declared response-header operations", async () => {
    const plan = await importFixture();

    expect(
      ["disable caching", "vary marker", "hide server"].map((comment) => {
        const rule = ruleWithComment(plan, comment);
        return {
          direction: rule.direction,
          operation: rule.operation,
          enabled: rule.enabled,
          hasValue: rule.value !== undefined,
        };
      }),
    ).toEqual([
      {
        direction: "response",
        operation: "set",
        enabled: true,
        hasValue: true,
      },
      {
        direction: "response",
        operation: "append",
        enabled: false,
        hasValue: true,
      },
      {
        direction: "response",
        operation: "remove",
        enabled: true,
        hasValue: false,
      },
    ]);
  });

  it("maps per-cookie request edits to whole-header appends with a warning", async () => {
    const plan = await importFixture();

    expect(ruleWithComment(plan, "preview cookie")).toMatchObject({
      direction: "request",
      operation: "append",
      header: "cookie",
      value: "session=preview",
      enabled: true,
    });
    expect(warningsOfKind(plan, "cookie-semantics-degraded")).toEqual([
      { kind: "cookie-semantics-degraded", ruleName: "preview cookie" },
    ]);
  });

  it("maps Set-Cookie edits to response sets with a warning", async () => {
    const plan = await importFixture();

    expect(ruleWithComment(plan, "theme cookie")).toMatchObject({
      direction: "response",
      operation: "set",
      header: "set-cookie",
      value: "theme=dark",
      enabled: false,
    });
    expect(warningsOfKind(plan, "set-cookie-semantics-degraded")).toEqual([
      { kind: "set-cookie-semantics-degraded", ruleName: "theme cookie" },
    ]);
  });

  it("maps CSP directives to response sets with a warning", async () => {
    const plan = await importFixture();

    expect(ruleWithComment(plan, "api policy")).toMatchObject({
      direction: "response",
      operation: "set",
      header: "content-security-policy",
      value: "connect-src 'self' https://api.example.com",
      enabled: true,
    });
    expect(warningsOfKind(plan, "csp-semantics-degraded")).toEqual([
      { kind: "csp-semantics-degraded", ruleName: "api policy" },
    ]);
  });

  it("maps URL filters to regex scope and disables rules rejected by the validator", async () => {
    const accepted = await importFixture();
    expect(ruleWithComment(accepted, "disable caching").scope).toEqual({
      type: "regex",
      regex: "^https://(?:www\\.)?example\\.com/",
      hosts: [],
    });

    const validateRegex = vi.fn<RegexValidator>(async (pattern) =>
      pattern.includes("(?=")
        ? err({ kind: "unsupported-regex" })
        : ok(undefined),
    );
    const rejected = await importFixture(INVALID_REGEX_URL, validateRegex);

    expect(validateRegex).toHaveBeenCalledWith("^https://(?=preview\\.)");
    expect(onlyProfile(rejected).rules).toMatchObject([{ enabled: false }]);
    // The url filter is one profile-wide scope, so an invalid pattern is a
    // single item naming the profile — not one warning per rule it disables.
    expect(warningsOfKind(rejected, "invalid-regex")).toEqual([
      {
        kind: "invalid-regex",
        ruleName: "Unsupported filter",
        pattern: "^https://(?=preview\\.)",
      },
    ]);
  });

  it("defaults to the all scope when no URL filter is enabled", async () => {
    const raw = JSON.stringify([
      {
        title: "Unscoped",
        headers: [{ enabled: true, name: "X-Debug", value: "on" }],
        urlFilters: [{ enabled: false, urlRegex: "^https://ignored\\." }],
      },
    ]);
    const result = await importModHeader(raw, [], acceptRegex);
    if (!result.ok) {
      throw new Error(`fixture import failed: ${result.error.kind}`);
    }

    expect(onlyProfile(result.value).rules).toMatchObject([
      {
        header: "x-debug",
        scope: { type: "all" },
        resourceTypes: "all",
        enabled: true,
      },
    ]);
    expect(result.value.warnings).toEqual([]);
  });

  it("combines multiple URL filters into one alternation and validates it", async () => {
    const profile = (urlFilters: { enabled: boolean; urlRegex: string }[]) =>
      JSON.stringify([
        {
          title: "Combined",
          headers: [{ enabled: true, name: "X-Debug", value: "on" }],
          urlFilters,
        },
      ]);
    const combined = "(?:^https://a\\.example/)|(?:^https://b\\.example/)";

    const validateRegex = vi.fn<RegexValidator>(async () => ok(undefined));
    const accepted = await importModHeader(
      profile([
        { enabled: true, urlRegex: "^https://a\\.example/" },
        { enabled: true, urlRegex: "^https://b\\.example/" },
        { enabled: true, urlRegex: "^https://a\\.example/" },
      ]),
      [],
      validateRegex,
    );
    if (!accepted.ok) {
      throw new Error(`fixture import failed: ${accepted.error.kind}`);
    }

    expect(onlyProfile(accepted.value).rules).toMatchObject([
      { scope: { type: "regex", regex: combined, hosts: [] }, enabled: true },
    ]);
    expect(validateRegex).toHaveBeenCalledWith(combined);

    const rejectCombined: RegexValidator = async (pattern) =>
      pattern === combined ? err({ kind: "unsupported-regex" }) : ok(undefined);
    const rejected = await importModHeader(
      profile([
        { enabled: true, urlRegex: "^https://a\\.example/" },
        { enabled: true, urlRegex: "^https://b\\.example/" },
      ]),
      [],
      rejectCombined,
    );
    if (!rejected.ok) {
      throw new Error(`fixture import failed: ${rejected.error.kind}`);
    }

    expect(onlyProfile(rejected.value).rules).toMatchObject([
      { enabled: false },
    ]);
    expect(rejected.value.warnings).toContainEqual({
      kind: "invalid-regex",
      ruleName: "Combined",
      pattern: combined,
    });
  });

  it("maps resource filters to portable resource groups", async () => {
    const plan = await importFixture();

    expect(ruleWithComment(plan, "disable caching").resourceTypes).toEqual([
      "pages",
      "subframes",
      "xhr",
      "scripts",
      "stylesheets",
      "images",
      "fonts",
      "media",
      "websockets",
      "other",
    ]);
  });

  it("itemizes every dropped exclude-URL filter", async () => {
    const warnings = warningsOfKind(
      await importFixture(),
      "exclude-url-filter-dropped",
    );

    expect(warnings).toHaveLength(2);
    expect(warnings.map(({ value }) => value)).toEqual(["logout", "health"]);
  });

  it("itemizes every dropped initiator-domain filter", async () => {
    const warnings = warningsOfKind(
      await importFixture(),
      "initiator-domain-filter-dropped",
    );

    expect(warnings).toHaveLength(2);
    expect(warnings.map(({ value }) => value)).toEqual([
      "app.example.com",
      "admin.example.com",
    ]);
  });

  it("itemizes dropped tab, tab-group, window, and time filters", async () => {
    const plan = await importFixture();

    expect(
      [
        "tab-filter-dropped",
        "tab-group-filter-dropped",
        "window-filter-dropped",
        "time-filter-dropped",
      ].map((kind) => plan.warnings.filter((warning) => warning.kind === kind)),
    ).toMatchObject([
      [{ value: "42" }],
      [{ value: "7" }],
      [{ value: "3" }],
      [{ value: "business hours" }],
    ]);
  });

  it("itemizes dropped URL replacements", async () => {
    expect(
      warningsOfKind(await importFixture(), "url-replacement-dropped"),
    ).toMatchObject([
      {
        ruleName: "Development: urlReplacements 1",
        value: "^https://old.example.com/",
      },
    ]);
  });

  it("keeps dynamic tokens literal and offers supported frozen conversions", async () => {
    const plan = await importFixture();

    expect(ruleWithComment(plan, "literal token header").value).toBe(
      "Bearer {{uuid}} from {{url_hostname}} at {{timestamp}}",
    );
    expect(warningsOfKind(plan, "dynamic-token")).toContainEqual({
      kind: "dynamic-token",
      ruleName: "literal token header",
      tokens: ["uuid", "url_hostname", "timestamp"],
      conversionOffer: {
        kind: "convert-to-frozen-value",
        tokens: ["uuid", "timestamp"],
      },
    });
  });

  it("preserves comments on every imported rule kind", async () => {
    const comments = onlyProfile(await importFixture()).rules.map(
      ({ comment }) => comment,
    );

    expect(comments).toEqual([
      "accepted response formats",
      "debug switch",
      "literal token header",
      "disable caching",
      "vary marker",
      "hide server",
      "preview cookie",
      "theme cookie",
      "api policy",
    ]);
  });

  it("resolves profile-name collisions without enabling imported profiles", async () => {
    const existing: Profile = {
      id: "existing",
      name: "development",
      badgeText: "DE",
      color: "blue",
      rules: [],
    };

    const imported = onlyProfile(
      await importFixture(PROFILE_URL, acceptRegex, [existing]),
    );
    expect(imported.name).toBe("Development 2");
    expect(imported).not.toHaveProperty("enabled");
  });

  it("detects the format and returns typed errors without partial plans", async () => {
    const parsed: unknown = JSON.parse(readFileSync(PROFILE_URL, "utf8"));
    expect(detectImportFormat(parsed)).toBe("modheader");
    await expect(importModHeader("{bad", [], acceptRegex)).resolves.toEqual({
      ok: false,
      error: { kind: "parse-failure" },
    });
    await expect(
      importModHeader(
        JSON.stringify({ title: "single object" }),
        [],
        acceptRegex,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "unrecognized-format" },
    });
    await expect(
      importModHeader(
        JSON.stringify([{ title: "Malformed", headers: [null] }]),
        [],
        acceptRegex,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "invalid-export" },
    });
  });
});
