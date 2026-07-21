import { beforeEach, describe, expect, it } from "vitest";
import type { RegexValidator } from "../../core/codec/modheader";
import type { Profile, Rule, RuleDraft, StateDoc } from "../../core/model";
import { err, ok, type Result } from "../../core/result";
import { read, write } from "../../platform/store";
import {
  profile,
  resetFixtures,
  rule,
  rules,
  stateDoc,
} from "../test/fixtures";
import { createMutations, type MutationError } from "./mutations";

const validRegex: RegexValidator = () => Promise.resolve(ok(undefined));
const invalidRegex: RegexValidator = () => Promise.resolve(err("unsupported"));

const mutations = createMutations({ validateRegex: validRegex });
const strictMutations = createMutations({ validateRegex: invalidRegex });

beforeEach(resetFixtures);

async function seed(
  profiles: Profile[],
  overrides: Partial<StateDoc> = {},
): Promise<StateDoc> {
  const doc = stateDoc(profiles, overrides);
  await write(doc);
  return doc;
}

function draft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return {
    direction: "request",
    operation: "set",
    header: "x-token",
    value: "abc",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

function errorKind<T>(
  outcome: Result<T, MutationError>,
): MutationError["kind"] | undefined {
  return outcome.ok ? undefined : outcome.error.kind;
}

function withoutValue(input: RuleDraft): RuleDraft {
  const { value: _value, ...rest } = input;
  return rest;
}

describe("saveRule", () => {
  it("creates a rule with an allocated num and a normalized header", async () => {
    const doc = await seed([profile("p1")]);
    const saved = await mutations.saveRule(
      "p1",
      undefined,
      draft({ header: "  X-Feature-Override " }),
    );

    expect(saved.ok).toBe(true);
    const stored = await read();
    expect(stored.profiles[0]?.rules).toHaveLength(1);
    expect(stored.profiles[0]?.rules[0]).toMatchObject({
      header: "x-feature-override",
      num: doc.nextRuleNum,
    });
    expect(stored.nextRuleNum).toBe(doc.nextRuleNum + 1);
  });

  it("normalizes the scope: trimmed, lowercased, deduplicated domains", async () => {
    await seed([profile("p1")]);
    const saved = await mutations.saveRule(
      "p1",
      undefined,
      draft({
        scope: {
          type: "domains",
          domains: [" API.Example.com", "api.example.com", ""],
        },
      }),
    );

    expect(saved.ok && saved.value.scope).toEqual({
      type: "domains",
      domains: ["api.example.com"],
    });
  });

  it("drops the value and generated metadata on remove operations", async () => {
    await seed([profile("p1")]);
    const saved = await mutations.saveRule(
      "p1",
      undefined,
      draft({
        operation: "remove",
        header: "referer",
        generated: { kind: "uuid", at: "2026-07-01T00:00:00.000Z" },
      }),
    );

    expect(saved.ok && "value" in saved.value).toBe(false);
    expect(saved.ok && "generated" in saved.value).toBe(false);
  });

  it("deduplicates resource types and rejects an empty selection", async () => {
    await seed([profile("p1")]);

    const saved = await mutations.saveRule(
      "p1",
      undefined,
      draft({ resourceTypes: ["xhr", "scripts", "xhr"] }),
    );
    expect(saved.ok && saved.value.resourceTypes).toEqual(["xhr", "scripts"]);

    expect(
      errorKind(
        await mutations.saveRule("p1", undefined, draft({ resourceTypes: [] })),
      ),
    ).toBe("scope-empty");
  });

  it.each([
    [draft({ header: ":authority" }), "name-not-modifiable"],
    [draft({ header: "bad header" }), "name-invalid"],
    [draft({ header: "   " }), "name-required"],
    [withoutValue(draft()), "value-required"],
    [draft({ value: "a\r\nb" }), "value-line-break"],
    [
      draft({ operation: "append", header: "x-custom-token" }),
      "request-append-not-allowed",
    ],
    [draft({ scope: { type: "domains", domains: [" "] } }), "scope-empty"],
    [draft({ scope: { type: "regex", regex: "", hosts: [] } }), "scope-empty"],
  ] as const)("blocks the save and changes nothing: %#", async (input, kind) => {
    const doc = await seed([profile("p1")]);
    const saved = await mutations.saveRule("p1", undefined, input);

    expect(errorKind(saved)).toBe(kind);
    expect(await read()).toEqual(doc);
  });

  it("allows append on an allowlisted request header", async () => {
    await seed([profile("p1")]);
    const saved = await mutations.saveRule(
      "p1",
      undefined,
      draft({ operation: "append", header: "accept-language" }),
    );
    expect(saved.ok).toBe(true);
  });

  it("validates a regex scope before save even when the rule is disabled", async () => {
    const doc = await seed([profile("p1")]);
    const saved = await strictMutations.saveRule(
      "p1",
      undefined,
      draft({
        enabled: false,
        scope: { type: "regex", regex: "(?<broken", hosts: [] },
      }),
    );

    expect(errorKind(saved)).toBe("regex-invalid");
    expect(await read()).toEqual(doc);
  });

  it("edits in place, preserving the rule's id and num", async () => {
    const existing = rule({ header: "x-old" });
    await seed([profile("p1", { rules: [existing] })]);
    const saved = await mutations.saveRule(
      "p1",
      existing.id,
      draft({ header: "x-new" }),
    );

    expect(saved.ok && saved.value).toMatchObject({
      id: existing.id,
      num: existing.num,
      header: "x-new",
    });
    const stored = await read();
    expect(stored.profiles[0]?.rules).toHaveLength(1);
    expect(stored.nextRuleNum).toBe(existing.num + 1);
  });

  it("reports a missing profile or rule as not-found", async () => {
    await seed([profile("p1")]);
    expect(
      errorKind(await mutations.saveRule("nope", undefined, draft())),
    ).toBe("not-found");
    expect(errorKind(await mutations.saveRule("p1", "ghost", draft()))).toBe(
      "not-found",
    );
  });

  it("blocks a new enabled rule past the 4,500 cap but allows a disabled one", async () => {
    await seed([profile("p1", { rules: rules(4_500) })]);

    expect(errorKind(await mutations.saveRule("p1", undefined, draft()))).toBe(
      "enabled-rule-limit-exceeded",
    );
    expect(
      (await mutations.saveRule("p1", undefined, draft({ enabled: false }))).ok,
    ).toBe(true);
  });

  it("blocks a save that would pass the 4 MB storage budget", async () => {
    await seed([profile("p1")]);
    const saved = await mutations.saveRule(
      "p1",
      undefined,
      draft({ value: "x".repeat(4 * 1024 * 1024) }),
    );
    expect(errorKind(saved)).toBe("doc-byte-limit-exceeded");
  });

  it("fails with store-unavailable when no valid document exists", async () => {
    expect(errorKind(await mutations.saveRule("p1", undefined, draft()))).toBe(
      "store-unavailable",
    );
  });
});

describe("setRuleEnabled", () => {
  it("toggles a rule off and back on", async () => {
    const target = rule();
    await seed([profile("p1", { rules: [target] })]);

    await mutations.setRuleEnabled("p1", target.id, false);
    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(false);
    await mutations.setRuleEnabled("p1", target.id, true);
    expect((await read()).profiles[0]?.rules[0]?.enabled).toBe(true);
  });

  it("fails at the cap boundary before commit", async () => {
    const disabled = rule({ enabled: false });
    const doc = await seed([
      profile("p1", { rules: [...rules(4_500), disabled] }),
    ]);

    const outcome = await mutations.setRuleEnabled("p1", disabled.id, true);
    expect(errorKind(outcome)).toBe("enabled-rule-limit-exceeded");
    expect(await read()).toEqual(doc);
  });

  it("fails at the 1,000 regex cap", async () => {
    const regexScope = (r: Rule): Rule => ({
      ...r,
      scope: { type: "regex", regex: "^a$", hosts: [] },
    });
    const disabled = regexScope(rule({ enabled: false }));
    await seed([
      profile("p1", { rules: [...rules(1_000).map(regexScope), disabled] }),
    ]);

    expect(
      errorKind(await mutations.setRuleEnabled("p1", disabled.id, true)),
    ).toBe("regex-rule-limit-exceeded");
  });

  it("re-validates a regex scope on enable, so an imported invalid rule cannot slip into the compiled set", async () => {
    const invalid = rule({
      enabled: false,
      scope: { type: "regex", regex: "(?<broken", hosts: [] },
    });
    const doc = await seed([profile("p1", { rules: [invalid] })]);

    const outcome = await strictMutations.setRuleEnabled(
      "p1",
      invalid.id,
      true,
    );
    expect(errorKind(outcome)).toBe("regex-invalid");
    expect(await read()).toEqual(doc);
  });

  it("does not re-validate rules that were already enabled", async () => {
    const alreadyEnabled = rule({
      scope: { type: "regex", regex: "^was-valid-once$", hosts: [] },
    });
    const plain = rule({ enabled: false });
    await seed([profile("p1", { rules: [alreadyEnabled, plain] })]);

    expect(
      (await strictMutations.setRuleEnabled("p1", plain.id, true)).ok,
    ).toBe(true);
  });
});

// Header grammar and urlFilter grammar are re-checked whenever a stored
// rule enters the enabled set. An imported (untrusted) rule can carry a CRLF
// value, a pseudo-header name, or a urlFilter Chrome rejects — stored disabled
// and structurally indistinguishable from a user-disabled one — so the enable
// gesture, on every path, is the last gate before the compiler.
describe("enable-path grammar re-validation", () => {
  it.each<[string, Partial<Rule>, MutationError["kind"]]>([
    ["a CRLF header value", { value: "a\r\nb" }, "value-line-break"],
    ["a pseudo-header name", { header: ":authority" }, "name-not-modifiable"],
    [
      "a non-ASCII url pattern",
      { scope: { type: "pattern", pattern: "||exämple.com^", hosts: [] } },
      "pattern-invalid",
    ],
    [
      "a wildcard-after-anchor url pattern",
      { scope: { type: "pattern", pattern: "||*", hosts: [] } },
      "pattern-invalid",
    ],
  ])("setRuleEnabled refuses %s and leaves the doc untouched", async (_label, overrides, kind) => {
    const invalid = rule({ enabled: false, ...overrides });
    const doc = await seed([profile("p1", { rules: [invalid] })]);

    expect(
      errorKind(await mutations.setRuleEnabled("p1", invalid.id, true)),
    ).toBe(kind);
    expect(await read()).toEqual(doc);
  });

  it("activateProfile refuses a profile carrying a bad enabled rule", async () => {
    const invalid = rule({ header: ":authority" });
    const doc = await seed([profile("p1", { rules: [invalid] })], {
      activeProfileId: undefined,
    });

    expect(errorKind(await mutations.activateProfile("p1"))).toBe(
      "name-not-modifiable",
    );
    expect(await read()).toEqual(doc);
  });
});

async function storedRuleIds(): Promise<string[]> {
  return (await read()).profiles[0]?.rules.map((r) => r.id) ?? [];
}

describe("delete, restore, and move", () => {
  it("delete returns the rule and its index; restore puts it back", async () => {
    const first = rule();
    const second = rule();
    const third = rule();
    await seed([profile("p1", { rules: [first, second, third] })]);

    const deleted = await mutations.deleteRule("p1", second.id);
    expect(deleted.ok && deleted.value).toEqual({ rule: second, index: 1 });
    expect(await storedRuleIds()).toEqual([first.id, third.id]);

    expect((await mutations.restoreRule("p1", second, 1)).ok).toBe(true);
    expect(await storedRuleIds()).toEqual([first.id, second.id, third.id]);
  });

  it("restore is idempotent when the rule is already present", async () => {
    const target = rule();
    const doc = await seed([profile("p1", { rules: [target] })]);
    expect((await mutations.restoreRule("p1", target, 0)).ok).toBe(true);
    expect(await read()).toEqual(doc);
  });

  it("restore respects the cap after the enabled set refilled", async () => {
    const doomed = rule();
    const disabled = rule({ enabled: false });
    await seed([profile("p1", { rules: [doomed, ...rules(4_499), disabled] })]);

    const deleted = await mutations.deleteRule("p1", doomed.id);
    expect(deleted.ok).toBe(true);
    expect((await mutations.setRuleEnabled("p1", disabled.id, true)).ok).toBe(
      true,
    );
    expect(errorKind(await mutations.restoreRule("p1", doomed, 0))).toBe(
      "enabled-rule-limit-exceeded",
    );
  });

  it("moves a rule to the end of another profile", async () => {
    const moving = rule();
    const resident = rule();
    await seed([
      profile("p1", { rules: [moving] }),
      profile("p2", { rules: [resident] }),
    ]);

    expect((await mutations.moveRuleToProfile("p1", moving.id, "p2")).ok).toBe(
      true,
    );
    const stored = await read();
    expect(stored.profiles[0]?.rules).toEqual([]);
    expect(stored.profiles[1]?.rules.map((r) => r.id)).toEqual([
      resident.id,
      moving.id,
    ]);
  });

  it("cap-checks a move from a disabled profile into an enabled one", async () => {
    const moving = rule();
    await seed([
      profile("p1", { rules: rules(4_500) }),
      profile("p2", { rules: [moving] }),
    ]);

    expect(
      errorKind(await mutations.moveRuleToProfile("p2", moving.id, "p1")),
    ).toBe("enabled-rule-limit-exceeded");
  });
});

describe("profile operations", () => {
  it("creates a profile, derives badge initials, and activates it atomically", async () => {
    await seed([profile("p1")]);
    const created = await mutations.createProfile({
      name: "Staging auth",
      color: "teal",
      enabled: true,
    });

    expect(created.ok && created.value).toMatchObject({
      name: "Staging auth",
      badgeText: "ST",
    });
    const stored = await read();
    expect(stored.profiles).toHaveLength(2);
    expect(stored.activeProfileId).toBe(created.ok ? created.value.id : "");
    expect(
      stored.profiles.every((candidate) => !("enabled" in candidate)),
    ).toBe(true);
  });

  it("does not change activation when the new profile arrives inactive", async () => {
    const doc = await seed([profile("p1")]);
    const created = await mutations.createProfile({
      name: "QA roles",
      badgeText: "QA",
      color: "plum",
      enabled: false,
    });
    expect(created.ok).toBe(true);
    expect((await read()).activeProfileId).toBe(doc.activeProfileId);
  });

  it.each([
    "p1",
    "P1",
    "  p1  ",
    "",
    "x".repeat(49),
  ])("rejects an unavailable or invalid name: %j", async (name) => {
    await seed([profile("p1")]);
    expect(
      errorKind(
        await mutations.createProfile({ name, color: "blue", enabled: false }),
      ),
    ).toBe("profile-name-unavailable");
  });

  it("renames with case-insensitive uniqueness, allowing a self-rename", async () => {
    await seed([profile("p1"), profile("p2")]);

    expect((await mutations.renameProfile("p1", "p1")).ok).toBe(true);
    expect(errorKind(await mutations.renameProfile("p1", "P2"))).toBe(
      "profile-name-unavailable",
    );
    expect((await mutations.renameProfile("p1", "Staging")).ok).toBe(true);
    expect((await read()).profiles[0]?.name).toBe("Staging");
  });

  it("clones deep with fresh rule identities and a ' copy' suffix", async () => {
    const source = rule();
    await seed([profile("p1", { rules: [source] }), profile("p2")]);

    const first = await mutations.cloneProfile("p1");
    expect(first.ok && first.value.name).toBe("p1 copy");
    const second = await mutations.cloneProfile("p1");
    expect(second.ok && second.value.name).toBe("p1 copy 2");

    const stored = await read();
    expect(stored.profiles.map((p) => p.name)).toEqual([
      "p1",
      "p1 copy 2",
      "p1 copy",
      "p2",
    ]);
    const clonedRule = first.ok ? first.value.rules[0] : undefined;
    expect(clonedRule).toMatchObject({ header: source.header });
    expect(clonedRule?.id).not.toBe(source.id);
    expect(clonedRule?.num).not.toBe(source.num);
  });

  it("keeps clone names within the 48-character limit", async () => {
    const long = "x".repeat(48);
    await seed([profile("p1", { name: long })]);
    const cloned = await mutations.cloneProfile("p1");
    expect(cloned.ok && cloned.value.name).toBe(`${"x".repeat(43)} copy`);
  });

  it("clones an active profile without making the clone active", async () => {
    await seed([profile("p1", { rules: rules(2_300) })]);
    const cloned = await mutations.cloneProfile("p1");
    expect(cloned.ok).toBe(true);
    const stored = await read();
    expect(stored.activeProfileId).toBe("p1");
    expect(
      stored.profiles.every((candidate) => !("enabled" in candidate)),
    ).toBe(true);
  });

  it("clears activation when deleting the active profile", async () => {
    await seed([profile("p1"), profile("p2"), profile("p3")], {
      activeProfileId: "p1",
    });

    const deleted = await mutations.deleteProfile("p1");
    expect(deleted.ok && deleted.value.index).toBe(0);
    expect((await read()).activeProfileId).toBeUndefined();
  });

  it("keeps activation cleared when restoring the deleted active profile", async () => {
    await seed([profile("p1"), profile("p2")], {
      activeProfileId: "p1",
    });

    const deleted = await mutations.deleteProfile("p1");
    if (!deleted.ok) {
      throw new Error("fixture profile must be deletable");
    }
    await mutations.restoreProfile(deleted.value.profile, deleted.value.index);

    const stored = await read();
    expect(stored.profiles.map((candidate) => candidate.id)).toContain("p1");
    expect(stored.activeProfileId).toBeUndefined();
  });

  it("recreates an inactive Default when the last profile is deleted", async () => {
    await seed([profile("p1")]);
    expect((await mutations.deleteProfile("p1")).ok).toBe(true);

    const stored = await read();
    expect(stored.profiles).toHaveLength(1);
    expect(stored.profiles[0]).toMatchObject({
      name: "Default",
      badgeText: "DE",
      rules: [],
    });
    expect(stored.activeProfileId).toBeUndefined();
    expect(stored.profiles[0]).not.toHaveProperty("enabled");
  });

  it("restores a deleted profile at its index, suffixing a retaken name", async () => {
    const doomed = profile("p2");
    await seed([profile("p1"), doomed, profile("p3")]);

    await mutations.deleteProfile("p2");
    await mutations.createProfile({
      name: "p2",
      color: "blue",
      enabled: false,
    });
    expect((await mutations.restoreProfile(doomed, 1)).ok).toBe(true);

    const stored = await read();
    const names = stored.profiles.map((p) => p.name);
    expect(names).toEqual(["p1", "p2 2", "p3", "p2"]);
    expect(stored.activeProfileId).toBe("p1");
    expect(
      stored.profiles.every((candidate) => !("enabled" in candidate)),
    ).toBe(true);
  });

  it("reorders profiles and clamps the target index", async () => {
    await seed([profile("p1"), profile("p2"), profile("p3")]);
    await mutations.reorderProfile("p3", 0);
    expect((await read()).profiles.map((p) => p.id)).toEqual([
      "p3",
      "p1",
      "p2",
    ]);
  });

  it("normalizes badge text to two graphemes", async () => {
    await seed([profile("p1")]);
    await mutations.setProfileBadge("p1", {
      badgeText: "STAGE",
      color: "green",
    });
    expect((await read()).profiles[0]).toMatchObject({
      badgeText: "ST",
      color: "green",
    });
  });
});

describe("activation semantics", () => {
  it("switches profiles with one foreign key so two-active is unrepresentable", async () => {
    await seed([profile("p1"), profile("p2"), profile("p3")]);

    expect((await mutations.activateProfile("p2")).ok).toBe(true);
    const stored = await read();
    expect(stored.activeProfileId).toBe("p2");
    expect(
      stored.profiles.every((candidate) => !("enabled" in candidate)),
    ).toBe(true);
  });

  it("deactivates every profile by clearing the foreign key", async () => {
    await seed([profile("p1"), profile("p2")]);

    expect((await mutations.activateProfile(undefined)).ok).toBe(true);
    const stored = await read();
    expect(stored.activeProfileId).toBeUndefined();
    expect(
      stored.profiles.every((candidate) => !("enabled" in candidate)),
    ).toBe(true);
  });

  it("reports not-found for an unknown profile", async () => {
    const doc = await seed([profile("p1")]);
    expect(errorKind(await mutations.activateProfile("missing"))).toBe(
      "not-found",
    );
    expect(await read()).toEqual(doc);
  });

  it("blocks activating a profile past the 4,500 cap before commit", async () => {
    const doc = await seed(
      [profile("p1"), profile("p2", { rules: rules(4_501) })],
      { activeProfileId: "p1" },
    );

    expect(errorKind(await mutations.activateProfile("p2"))).toBe(
      "enabled-rule-limit-exceeded",
    );
    expect(await read()).toEqual(doc);
  });

  it("re-validates regex scopes when activation brings them into the enabled set", async () => {
    const imported = rule({
      scope: { type: "regex", regex: "(?<broken", hosts: [] },
    });
    await seed([profile("p1"), profile("p2", { rules: [imported] })]);

    const outcome = await strictMutations.activateProfile("p2");
    expect(errorKind(outcome)).toBe("regex-invalid");
    if (!outcome.ok && outcome.error.kind === "regex-invalid") {
      expect(outcome.error.regex).toBe("(?<broken");
    }
  });
});

describe("settings and import", () => {
  it("round-trips pause and theme", async () => {
    await seed([profile("p1")]);

    await mutations.setPaused(true);
    await mutations.setTheme("dark");
    expect((await read()).settings).toEqual({
      paused: true,
      theme: "dark",
    });
    await mutations.setPaused(false);
    expect((await read()).settings.paused).toBe(false);
  });

  it("applies an import plan without activating profiles and with fresh rule numbers", async () => {
    const doc = await seed([profile("p1")]);
    const outcome = await mutations.applyImport({
      profiles: [
        {
          name: "Imported",
          badgeText: "IM",
          color: "blue",
          rules: [
            {
              direction: "request",
              operation: "set",
              header: "x-imported",
              value: "1",
              scope: { type: "domains", domains: ["example.com"] },
              resourceTypes: "all",
              initiators: [],
              enabled: true,
            },
          ],
        },
      ],
      warnings: [],
    });

    expect(outcome.ok).toBe(true);
    const stored = await read();
    expect(stored.profiles[1]).toMatchObject({ name: "Imported" });
    expect(stored.profiles[1]).not.toHaveProperty("enabled");
    expect(stored.activeProfileId).toBe("p1");
    expect(stored.profiles[1]?.rules[0]?.num).toBe(doc.nextRuleNum);
  });

  it("suffixes a plan name that was claimed after the plan was made", async () => {
    await seed([profile("p1")]);
    const outcome = await mutations.applyImport({
      profiles: [
        {
          name: "p1",
          badgeText: "P1",
          color: "blue",
          rules: [],
        },
      ],
      warnings: [],
    });

    expect(outcome.ok).toBe(true);
    expect((await read()).profiles.map((p) => p.name)).toEqual(["p1", "p1 2"]);
  });

  it("enforces the byte budget on import-apply", async () => {
    await seed([profile("p1")]);
    const outcome = await mutations.applyImport({
      profiles: [
        {
          name: "Huge",
          badgeText: "HU",
          color: "blue",
          rules: [
            {
              direction: "request",
              operation: "set",
              header: "x-huge",
              value: "x".repeat(4 * 1024 * 1024),
              scope: { type: "domains", domains: ["example.com"] },
              resourceTypes: "all",
              initiators: [],
              enabled: false,
            },
          ],
        },
      ],
      warnings: [],
    });
    expect(errorKind(outcome)).toBe("doc-byte-limit-exceeded");
  });
});

describe("serialization", () => {
  it("interleaved mutations both land — the lock serializes writers", async () => {
    await seed([profile("p1")]);

    const [saved, paused] = await Promise.all([
      mutations.saveRule("p1", undefined, draft()),
      mutations.setPaused(true),
    ]);

    expect(saved.ok && paused.ok).toBe(true);
    const stored = await read();
    expect(stored.profiles[0]?.rules).toHaveLength(1);
    expect(stored.settings.paused).toBe(true);
  });
});
