import { beforeEach, describe, expect, it } from "vitest";
import type { RegexValidator } from "../../core/codec/modheader";
import type { Profile, Rule, RuleDraft, StateDoc } from "../../core/model";
import { err, ok, type Result } from "../../core/result";
import { read, write } from "../../platform/store";
import { createMutations, type MutationError } from "./mutations";

const validRegex: RegexValidator = () => Promise.resolve(ok(undefined));
const invalidRegex: RegexValidator = () => Promise.resolve(err("unsupported"));

const mutations = createMutations({ validateRegex: validRegex });
const strictMutations = createMutations({ validateRegex: invalidRegex });

let seq = 0;
beforeEach(() => {
  seq = 0;
});

function rule(overrides: Partial<Rule> = {}): Rule {
  seq += 1;
  return {
    id: `rule-${seq}`,
    num: seq,
    direction: "request",
    operation: "set",
    header: "x-test",
    value: "1",
    scope: { type: "domains", domains: ["example.com"] },
    resourceTypes: "all",
    initiators: [],
    enabled: true,
    ...overrides,
  };
}

function rules(count: number, overrides: Partial<Rule> = {}): Rule[] {
  return Array.from({ length: count }, () => rule(overrides));
}

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    name: id,
    badgeText: "DE",
    color: "indigo",
    enabled: true,
    rules: [],
    ...overrides,
  };
}

async function seed(
  profiles: Profile[],
  overrides: Partial<StateDoc> = {},
): Promise<StateDoc> {
  const doc: StateDoc = {
    v: 1,
    profiles,
    focusedProfileId: profiles[0]?.id ?? "",
    nextRuleNum: seq + 1,
    settings: { paused: false, theme: "system", badgeMode: "count" },
    ...overrides,
  };
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

async function storedRuleIds(): Promise<string[]> {
  return (await read()).profiles[0]?.rules.map((r) => r.id) ?? [];
}

describe("delete, restore, reorder, move, duplicate", () => {
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

  it("reorders within the profile and clamps out-of-range targets", async () => {
    const first = rule();
    const second = rule();
    const third = rule();
    await seed([profile("p1", { rules: [first, second, third] })]);

    await mutations.reorderRule("p1", third.id, 0);
    expect(await storedRuleIds()).toEqual([third.id, first.id, second.id]);

    await mutations.reorderRule("p1", third.id, 99);
    expect(await storedRuleIds()).toEqual([first.id, second.id, third.id]);
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
      profile("p2", { enabled: false, rules: [moving] }),
    ]);

    expect(
      errorKind(await mutations.moveRuleToProfile("p2", moving.id, "p1")),
    ).toBe("enabled-rule-limit-exceeded");
  });

  it("duplicates a rule right after the original with a fresh identity", async () => {
    const source = rule();
    const trailing = rule();
    await seed([profile("p1", { rules: [source, trailing] })]);

    const copied = await mutations.duplicateRule("p1", source.id);
    expect(copied.ok).toBe(true);
    const stored = await read();
    const ids = stored.profiles[0]?.rules.map((r) => r.id);
    expect(ids).toHaveLength(3);
    expect(ids?.[0]).toBe(source.id);
    expect(ids?.[2]).toBe(trailing.id);
    expect(copied.ok && copied.value).toMatchObject({
      header: source.header,
      num: 3,
    });
  });

  it("cap-checks duplicating an enabled rule at the boundary", async () => {
    const source = rule();
    await seed([profile("p1", { rules: [source, ...rules(4_499)] })]);
    expect(errorKind(await mutations.duplicateRule("p1", source.id))).toBe(
      "enabled-rule-limit-exceeded",
    );
  });
});

describe("regenerateValue", () => {
  const frozenAt = "2026-07-01T00:00:00.000Z";
  const now = new Date("2026-07-13T09:30:00.000Z");

  async function regenerateFrozen(kind: "uuid" | "timestamp", value: string) {
    const frozen = rule({ value, generated: { kind, at: frozenAt } });
    await seed([profile("p1", { rules: [frozen] })]);
    return mutations.regenerateValue("p1", frozen.id, now);
  }

  it("re-freezes a uuid value and stamps the regeneration time", async () => {
    const uuid = "5e0e2a1c-59c4-4b0c-a41e-0d76f7ea54b9";
    const outcome = await regenerateFrozen("uuid", uuid);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.value).toMatch(/^[0-9a-f-]{36}$/);
      expect(outcome.value.value).not.toBe(uuid);
      expect(outcome.value.generated).toEqual({
        kind: "uuid",
        at: now.toISOString(),
      });
    }
  });

  it("writes the regeneration instant as a timestamp value", async () => {
    const outcome = await regenerateFrozen("timestamp", frozenAt);
    expect(outcome.ok && outcome.value.value).toBe(now.toISOString());
  });

  it("refuses on a rule without a generated value", async () => {
    const plain = rule();
    await seed([profile("p1", { rules: [plain] })]);
    expect(errorKind(await mutations.regenerateValue("p1", plain.id))).toBe(
      "not-found",
    );
  });

  it("refuses on a remove rule, which must stay value-free", async () => {
    const removal = rule({
      operation: "remove",
      generated: { kind: "uuid", at: frozenAt },
    });
    const { value: _value, ...valueless } = removal;
    await seed([profile("p1", { rules: [valueless] })]);
    expect(errorKind(await mutations.regenerateValue("p1", removal.id))).toBe(
      "not-found",
    );
  });
});

describe("profile operations", () => {
  it("creates a profile, derives badge initials, and focuses it when enabled", async () => {
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
    expect(stored.focusedProfileId).toBe(created.ok ? created.value.id : "");
  });

  it("does not move focus when the new profile arrives off", async () => {
    const doc = await seed([profile("p1")]);
    const created = await mutations.createProfile({
      name: "QA roles",
      badgeText: "QA",
      color: "plum",
      enabled: false,
    });
    expect(created.ok).toBe(true);
    expect((await read()).focusedProfileId).toBe(doc.focusedProfileId);
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

  it("cap-checks cloning an enabled profile", async () => {
    await seed([profile("p1", { rules: rules(2_300) })]);
    expect(errorKind(await mutations.cloneProfile("p1"))).toBe(
      "enabled-rule-limit-exceeded",
    );
  });

  it("deletes a profile and moves focus to the topmost enabled one", async () => {
    await seed(
      [profile("p1"), profile("p2", { enabled: false }), profile("p3")],
      { focusedProfileId: "p1" },
    );

    const deleted = await mutations.deleteProfile("p1");
    expect(deleted.ok && deleted.value.index).toBe(0);
    expect((await read()).focusedProfileId).toBe("p3");
  });

  it("falls back to the topmost profile when none is enabled", async () => {
    await seed([profile("p1"), profile("p2", { enabled: false })], {
      focusedProfileId: "p1",
    });
    await mutations.deleteProfile("p1");
    expect((await read()).focusedProfileId).toBe("p2");
  });

  it("recreates an enabled, focused Default when the last profile is deleted", async () => {
    await seed([profile("p1")]);
    expect((await mutations.deleteProfile("p1")).ok).toBe(true);

    const stored = await read();
    expect(stored.profiles).toHaveLength(1);
    expect(stored.profiles[0]).toMatchObject({
      name: "Default",
      badgeText: "DE",
      enabled: true,
      rules: [],
    });
    expect(stored.focusedProfileId).toBe(stored.profiles[0]?.id);
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

    const names = (await read()).profiles.map((p) => p.name);
    expect(names).toEqual(["p1", "p2 2", "p3", "p2"]);
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

describe("enable semantics (SPEC §2.1)", () => {
  it("activateProfile is the exclusive switch: target on, others off, focused", async () => {
    await seed([
      profile("p1"),
      profile("p2", { enabled: false }),
      profile("p3"),
    ]);

    expect((await mutations.activateProfile("p2")).ok).toBe(true);
    const stored = await read();
    expect(stored.profiles.map((p) => p.enabled)).toEqual([false, true, false]);
    expect(stored.focusedProfileId).toBe("p2");
  });

  it("toggling a profile on flips only it and focuses it", async () => {
    await seed([profile("p1"), profile("p2", { enabled: false })]);

    expect((await mutations.setProfileEnabled("p2", true)).ok).toBe(true);
    const stored = await read();
    expect(stored.profiles.map((p) => p.enabled)).toEqual([true, true]);
    expect(stored.focusedProfileId).toBe("p2");
  });

  it("disabling the focused profile moves focus to the topmost enabled one", async () => {
    await seed([profile("p1"), profile("p2")], { focusedProfileId: "p2" });
    await mutations.setProfileEnabled("p2", false);
    expect((await read()).focusedProfileId).toBe("p1");
  });

  it("disabling the last enabled focused profile falls back to the topmost", async () => {
    await seed([profile("p1", { enabled: false }), profile("p2")], {
      focusedProfileId: "p2",
    });
    await mutations.setProfileEnabled("p2", false);
    expect((await read()).focusedProfileId).toBe("p1");
  });

  it("disabling a non-focused profile leaves focus alone", async () => {
    await seed([profile("p1"), profile("p2")], { focusedProfileId: "p1" });
    await mutations.setProfileEnabled("p2", false);
    expect((await read()).focusedProfileId).toBe("p1");
  });

  it("blocks enabling a profile that would cross the 4,500 cap, before commit", async () => {
    const doc = await seed([
      profile("p1", { rules: rules(4_000) }),
      profile("p2", { enabled: false, rules: rules(600) }),
    ]);

    expect(errorKind(await mutations.setProfileEnabled("p2", true))).toBe(
      "enabled-rule-limit-exceeded",
    );
    expect(await read()).toEqual(doc);
  });

  it("blocks the exclusive switch onto an oversized profile with the same error", async () => {
    await seed([
      profile("p1"),
      profile("p2", { enabled: false, rules: rules(4_501) }),
    ]);
    expect(errorKind(await mutations.activateProfile("p2"))).toBe(
      "enabled-rule-limit-exceeded",
    );
  });

  it("re-validates regex scopes when a profile enable brings them into the enabled set", async () => {
    const imported = rule({
      scope: { type: "regex", regex: "(?<broken", hosts: [] },
    });
    await seed([
      profile("p1"),
      profile("p2", { enabled: false, rules: [imported] }),
    ]);

    const outcome = await strictMutations.setProfileEnabled("p2", true);
    expect(errorKind(outcome)).toBe("regex-invalid");
    if (!outcome.ok && outcome.error.kind === "regex-invalid") {
      expect(outcome.error.regex).toBe("(?<broken");
    }
  });
});

describe("settings and import", () => {
  it("round-trips pause, theme, and badge mode", async () => {
    await seed([profile("p1")]);

    await mutations.setPaused(true);
    await mutations.setTheme("dark");
    await mutations.setBadgeMode("initials");
    expect((await read()).settings).toEqual({
      paused: true,
      theme: "dark",
      badgeMode: "initials",
    });
    await mutations.setPaused(false);
    expect((await read()).settings.paused).toBe(false);
  });

  it("applies an import plan: profiles arrive off with fresh rule numbers", async () => {
    const doc = await seed([profile("p1")]);
    const outcome = await mutations.applyImport({
      profiles: [
        {
          name: "Imported",
          badgeText: "IM",
          color: "blue",
          enabled: false,
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
    expect(stored.profiles[1]).toMatchObject({
      name: "Imported",
      enabled: false,
    });
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
          enabled: false,
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
          enabled: false,
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
