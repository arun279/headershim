import {
  applyImportPlan,
  availableProfileName,
  type ImportedProfile,
  type ImportPlan,
} from "../../core/codec/headershim";
import type { RegexValidator } from "../../core/codec/modheader";
import { type HeaderValidationError, validateHeader } from "../../core/headers";
import {
  checkEnabledRuleLimits,
  checkStateDocByteLimit,
  type LimitError,
} from "../../core/limits";
import {
  type BadgeColor,
  createProfile as buildProfile,
  cloneRule,
  createRule,
  isProfileNameAvailable,
  normalizeBadgeText,
  type Profile,
  type Rule,
  type RuleDraft,
  type Scope,
  type Settings,
  type StateDoc,
} from "../../core/model";
import { err, ok, type Result } from "../../core/result";
import { migrate } from "../../core/schema";
import { type UrlFilterError, validateUrlFilter } from "../../core/scope";
import { locked, readRaw, write } from "../../platform/store";

/**
 * The complete write API over the state document. Popup and options share this
 * single path, so every save-time invariant — header validation, the enabled
 * and regex rule caps on every growth path, regex re-validation whenever a
 * stored rule enters the enabled set, and the storage byte budget — is
 * enforced here, inside one cross-context lock, before anything commits.
 */
export type MutationError =
  | LimitError
  | HeaderValidationError
  | {
      readonly kind: "regex-invalid";
      readonly regex: string;
      readonly reason: unknown;
    }
  | {
      readonly kind: "pattern-invalid";
      readonly pattern: string;
      readonly reason: UrlFilterError;
    }
  | { readonly kind: "scope-empty" }
  | { readonly kind: "profile-name-unavailable"; readonly name: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "store-unavailable" };

type MutationResult<T> = Promise<Result<T, MutationError>>;
type Step<T> = Result<readonly [StateDoc, T], MutationError>;

export interface MutationDeps {
  readonly validateRegex: RegexValidator;
}

/** The write API surface shared by the popup and options entrypoints. */
export type Mutations = ReturnType<typeof createMutations>;

export function createMutations({ validateRegex }: MutationDeps) {
  function commit<T>(
    mutate: (doc: StateDoc) => Step<T> | Promise<Step<T>>,
  ): MutationResult<T> {
    return locked(async () => {
      const stored = migrate(await readRaw());
      if (!stored.ok) {
        return err({ kind: "store-unavailable" } as const);
      }
      const step = await mutate(stored.value);
      if (!step.ok) {
        return step;
      }
      const [next, value] = step.value;
      const guarded = await guardCommit(stored.value, next);
      if (!guarded.ok) {
        return guarded;
      }
      await write(next);
      return ok(value);
    });
  }

  // Cap checks run on every mutation that grows the enabled set or its regex
  // subset; shrinking mutations must never be blocked by a doc already at the
  // boundary. Header grammar and pattern/regex scopes are re-validated whenever
  // a rule enters the enabled set — an imported rule (an untrusted writer) can
  // carry a name/value that fails validateHeader's HTTP-token/CRLF grammar, an
  // RE2-invalid regex, or a urlFilter Chrome's grammar rejects, stored disabled
  // and indistinguishable from a user-disabled one, so the enable gesture is the
  // last safe gate before the compiler would hand Chrome a rule whose update
  // rejects the whole atomic batch.
  async function guardCommit(
    prev: StateDoc,
    next: StateDoc,
  ): Promise<Result<void, MutationError>> {
    const prevEnabled = enabledRules(prev);
    const nextEnabled = enabledRules(next);
    if (
      nextEnabled.length > prevEnabled.length ||
      regexCount(nextEnabled) > regexCount(prevEnabled)
    ) {
      const limits = checkEnabledRuleLimits(nextEnabled);
      if (!limits.ok) {
        return limits;
      }
    }

    const prevEnabledIds = new Set(prevEnabled.map((rule) => rule.id));
    for (const rule of nextEnabled) {
      if (prevEnabledIds.has(rule.id)) {
        continue;
      }
      const header = validateHeader({
        direction: rule.direction,
        operation: rule.operation,
        header: rule.header,
        ...(rule.value === undefined ? {} : { value: rule.value }),
      });
      if (!header.ok) {
        return header;
      }
      if (rule.scope.type === "pattern") {
        const grammar = validateUrlFilter(rule.scope.pattern);
        if (!grammar.ok) {
          return err({
            kind: "pattern-invalid",
            pattern: rule.scope.pattern,
            reason: grammar.error,
          } as const);
        }
        continue;
      }
      if (rule.scope.type !== "regex") {
        continue;
      }
      const supported = await validateRegex(rule.scope.regex);
      if (!supported.ok) {
        return err({
          kind: "regex-invalid",
          regex: rule.scope.regex,
          reason: supported.error,
        } as const);
      }
    }

    return checkStateDocByteLimit(next);
  }

  return {
    saveRule(
      profileId: string,
      ruleId: string | undefined,
      draft: RuleDraft,
    ): MutationResult<Rule> {
      return commit(async (doc) => {
        const profile = findProfile(doc, profileId);
        if (profile === undefined) {
          return notFound();
        }
        const sanitized = await sanitizeDraft(draft, validateRegex);
        if (!sanitized.ok) {
          return sanitized;
        }

        if (ruleId === undefined) {
          const [rule, next] = createRule(doc, sanitized.value);
          return ok([
            withRules(next, profileId, (list) => [...list, rule]),
            rule,
          ]);
        }

        const existing = profile.rules.find((rule) => rule.id === ruleId);
        if (existing === undefined) {
          return notFound();
        }
        // Edits keep the rule's identity: the stable num is what match
        // attribution and undo bookkeeping hang on to.
        const rule: Rule = {
          id: existing.id,
          num: existing.num,
          ...sanitized.value,
        };
        return ok([
          withRules(doc, profileId, (list) =>
            list.map((candidate) =>
              candidate.id === ruleId ? rule : candidate,
            ),
          ),
          rule,
        ]);
      });
    },

    deleteRule(
      profileId: string,
      ruleId: string,
    ): MutationResult<{ rule: Rule; index: number }> {
      return commit((doc) => {
        const profile = findProfile(doc, profileId);
        const index =
          profile?.rules.findIndex((rule) => rule.id === ruleId) ?? -1;
        const rule = profile?.rules[index];
        if (rule === undefined) {
          return notFound();
        }
        return ok([
          withRules(doc, profileId, (list) =>
            list.filter((candidate) => candidate.id !== ruleId),
          ),
          { rule, index },
        ]);
      });
    },

    restoreRule(
      profileId: string,
      rule: Rule,
      index: number,
    ): MutationResult<void> {
      return commit((doc) => {
        if (
          doc.profiles.some((profile) =>
            profile.rules.some((candidate) => candidate.id === rule.id),
          )
        ) {
          return ok([doc, undefined]);
        }
        if (findProfile(doc, profileId) === undefined) {
          return notFound();
        }
        return ok([
          withRules(doc, profileId, (list) => insertAt(list, rule, index)),
          undefined,
        ]);
      });
    },

    setRuleEnabled(
      profileId: string,
      ruleId: string,
      enabled: boolean,
    ): MutationResult<void> {
      return commit((doc) => {
        if (findRule(doc, profileId, ruleId) === undefined) {
          return notFound();
        }
        return ok([
          withRules(doc, profileId, (list) =>
            list.map((rule) =>
              rule.id === ruleId ? { ...rule, enabled } : rule,
            ),
          ),
          undefined,
        ]);
      });
    },

    reorderRule(
      profileId: string,
      ruleId: string,
      toIndex: number,
    ): MutationResult<void> {
      return commit((doc) => {
        const profile = findProfile(doc, profileId);
        const rule = profile?.rules.find(
          (candidate) => candidate.id === ruleId,
        );
        if (profile === undefined || rule === undefined) {
          return notFound();
        }
        return ok([
          withRules(doc, profileId, (list) =>
            insertAt(
              list.filter((candidate) => candidate.id !== ruleId),
              rule,
              toIndex,
            ),
          ),
          undefined,
        ]);
      });
    },

    moveRuleToProfile(
      fromProfileId: string,
      ruleId: string,
      toProfileId: string,
    ): MutationResult<void> {
      return commit((doc) => {
        const rule = findRule(doc, fromProfileId, ruleId);
        if (rule === undefined || findProfile(doc, toProfileId) === undefined) {
          return notFound();
        }
        if (fromProfileId === toProfileId) {
          return ok([doc, undefined]);
        }
        const removed = withRules(doc, fromProfileId, (list) =>
          list.filter((candidate) => candidate.id !== ruleId),
        );
        return ok([
          withRules(removed, toProfileId, (list) => [...list, rule]),
          undefined,
        ]);
      });
    },

    // Bulk actions from the options Profiles page (SPEC §4.2). Each is one
    // commit under the shared lock, so the enabled-set cap, regex re-validation,
    // and byte budget in guardCommit gate the whole batch atomically rather than
    // rule by rule.
    setRulesEnabled(
      profileId: string,
      ruleIds: readonly string[],
      enabled: boolean,
    ): MutationResult<void> {
      return commit((doc) => {
        if (findProfile(doc, profileId) === undefined) {
          return notFound();
        }
        const ids = new Set(ruleIds);
        return ok([
          withRules(doc, profileId, (list) =>
            list.map((rule) =>
              ids.has(rule.id) ? { ...rule, enabled } : rule,
            ),
          ),
          undefined,
        ]);
      });
    },

    deleteRules(
      profileId: string,
      ruleIds: readonly string[],
    ): MutationResult<{ removed: readonly { rule: Rule; index: number }[] }> {
      return commit((doc) => {
        const profile = findProfile(doc, profileId);
        if (profile === undefined) {
          return notFound();
        }
        const ids = new Set(ruleIds);
        const removed = profile.rules
          .map((rule, index) => ({ rule, index }))
          .filter((entry) => ids.has(entry.rule.id));
        return ok([
          withRules(doc, profileId, (list) =>
            list.filter((rule) => !ids.has(rule.id)),
          ),
          { removed },
        ]);
      });
    },

    restoreRules(
      profileId: string,
      removed: readonly { rule: Rule; index: number }[],
    ): MutationResult<void> {
      return commit((doc) => {
        if (findProfile(doc, profileId) === undefined) {
          return notFound();
        }
        const present = new Set(
          doc.profiles.flatMap((profile) =>
            profile.rules.map((rule) => rule.id),
          ),
        );
        // Re-insert at the original positions in ascending order so each stored
        // index still addresses the slot it was removed from.
        const toInsert = removed
          .filter((entry) => !present.has(entry.rule.id))
          .sort((a, b) => a.index - b.index);
        return ok([
          withRules(doc, profileId, (list) =>
            toInsert.reduce(
              (next, entry) => insertAt(next, entry.rule, entry.index),
              [...list],
            ),
          ),
          undefined,
        ]);
      });
    },

    moveRulesToProfile(
      fromProfileId: string,
      ruleIds: readonly string[],
      toProfileId: string,
    ): MutationResult<void> {
      return commit((doc) => {
        const from = findProfile(doc, fromProfileId);
        if (from === undefined || findProfile(doc, toProfileId) === undefined) {
          return notFound();
        }
        const ids = new Set(ruleIds);
        const moving = from.rules.filter((rule) => ids.has(rule.id));
        if (fromProfileId === toProfileId || moving.length === 0) {
          return ok([doc, undefined]);
        }
        const removed = withRules(doc, fromProfileId, (list) =>
          list.filter((rule) => !ids.has(rule.id)),
        );
        return ok([
          withRules(removed, toProfileId, (list) => [...list, ...moving]),
          undefined,
        ]);
      });
    },

    duplicateRule(profileId: string, ruleId: string): MutationResult<Rule> {
      return commit((doc) => {
        const profile = findProfile(doc, profileId);
        const index =
          profile?.rules.findIndex((rule) => rule.id === ruleId) ?? -1;
        const source = profile?.rules[index];
        if (source === undefined) {
          return notFound();
        }
        const [copy, next] = cloneRule(doc, source);
        return ok([
          withRules(next, profileId, (list) => insertAt(list, copy, index + 1)),
          copy,
        ]);
      });
    },

    regenerateValue(
      profileId: string,
      ruleId: string,
      now = new Date(),
    ): MutationResult<Rule> {
      return commit((doc) => {
        const source = findRule(doc, profileId, ruleId);
        const generated = source?.generated;
        if (
          source === undefined ||
          generated === undefined ||
          // A remove rule carries no value to regenerate.
          source.operation === "remove"
        ) {
          return notFound();
        }
        const at = now.toISOString();
        const rule: Rule = {
          ...source,
          value: generated.kind === "uuid" ? crypto.randomUUID() : at,
          generated: { kind: generated.kind, at },
        };
        return ok([
          withRules(doc, profileId, (list) =>
            list.map((candidate) =>
              candidate.id === ruleId ? rule : candidate,
            ),
          ),
          rule,
        ]);
      });
    },

    createProfile(input: {
      name: string;
      badgeText?: string;
      color: BadgeColor;
      enabled: boolean;
    }): MutationResult<Profile> {
      return commit((doc) => {
        const name = input.name.trim();
        if (!isProfileNameAvailable(doc.profiles, name)) {
          return err({ kind: "profile-name-unavailable", name } as const);
        }
        const profile = buildProfile({
          name,
          badgeText: input.badgeText ?? defaultBadgeText(name),
          color: input.color,
          enabled: input.enabled,
        });
        const next: StateDoc = {
          ...doc,
          profiles: [...doc.profiles, profile],
          // Enabling a profile focuses it (SPEC §2.1); creating one enabled is
          // the same gesture.
          ...(input.enabled ? { focusedProfileId: profile.id } : {}),
        };
        return ok([next, profile]);
      });
    },

    renameProfile(profileId: string, name: string): MutationResult<void> {
      return commit((doc) => {
        if (findProfile(doc, profileId) === undefined) {
          return notFound();
        }
        const trimmed = name.trim();
        if (!isProfileNameAvailable(doc.profiles, trimmed, profileId)) {
          return err({
            kind: "profile-name-unavailable",
            name: trimmed,
          } as const);
        }
        return ok([
          withProfile(doc, profileId, (profile) => ({
            ...profile,
            name: trimmed,
          })),
          undefined,
        ]);
      });
    },

    cloneProfile(profileId: string): MutationResult<Profile> {
      return commit((doc) => {
        const index = doc.profiles.findIndex(
          (profile) => profile.id === profileId,
        );
        const source = doc.profiles[index];
        if (source === undefined) {
          return notFound();
        }
        const shell = buildProfile({
          name: cloneName(source.name, doc.profiles),
          badgeText: source.badgeText,
          color: source.color,
          enabled: source.enabled,
        });
        let next = doc;
        const copies: Rule[] = [];
        for (const rule of source.rules) {
          const [copy, allocated] = cloneRule(next, rule);
          copies.push(copy);
          next = allocated;
        }
        const clone: Profile = { ...shell, rules: copies };
        return ok([
          { ...next, profiles: insertAt(next.profiles, clone, index + 1) },
          clone,
        ]);
      });
    },

    deleteProfile(
      profileId: string,
    ): MutationResult<{ profile: Profile; index: number }> {
      return commit((doc) => {
        const index = doc.profiles.findIndex(
          (profile) => profile.id === profileId,
        );
        const removed = doc.profiles[index];
        if (removed === undefined) {
          return notFound();
        }
        const remaining = doc.profiles.filter(
          (profile) => profile.id !== profileId,
        );
        // The product never has zero profiles: deleting the last one
        // immediately recreates an empty Default (SPEC §2.1).
        const profiles =
          remaining.length > 0
            ? remaining
            : [
                buildProfile({
                  name: "Default",
                  badgeText: "DE",
                  color: "indigo",
                  enabled: true,
                }),
              ];
        const next: StateDoc = {
          ...doc,
          profiles,
          focusedProfileId:
            doc.focusedProfileId === profileId
              ? topmostFocus(profiles)
              : doc.focusedProfileId,
        };
        return ok([next, { profile: removed, index }]);
      });
    },

    restoreProfile(profile: Profile, index: number): MutationResult<void> {
      return commit((doc) => {
        if (doc.profiles.some((candidate) => candidate.id === profile.id)) {
          return ok([doc, undefined]);
        }
        const restored: Profile = {
          ...profile,
          name: availableProfileName(profile.name, doc.profiles, []),
        };
        return ok([
          { ...doc, profiles: insertAt(doc.profiles, restored, index) },
          undefined,
        ]);
      });
    },

    reorderProfile(profileId: string, toIndex: number): MutationResult<void> {
      return commit((doc) => {
        const profile = findProfile(doc, profileId);
        if (profile === undefined) {
          return notFound();
        }
        return ok([
          {
            ...doc,
            profiles: insertAt(
              doc.profiles.filter((candidate) => candidate.id !== profileId),
              profile,
              toIndex,
            ),
          },
          undefined,
        ]);
      });
    },

    setProfileEnabled(
      profileId: string,
      enabled: boolean,
    ): MutationResult<void> {
      return commit((doc) => {
        const profile = findProfile(doc, profileId);
        if (profile === undefined) {
          return notFound();
        }
        if (profile.enabled === enabled) {
          return ok([doc, undefined]);
        }
        const next = withProfile(doc, profileId, (candidate) => ({
          ...candidate,
          enabled,
        }));
        // Focus follows enablement (SPEC §2.1): enabling focuses the profile;
        // disabling the focused one moves focus to the topmost enabled
        // profile, or the topmost profile when none is enabled.
        const focusedProfileId = enabled
          ? profileId
          : doc.focusedProfileId === profileId
            ? topmostFocus(next.profiles)
            : doc.focusedProfileId;
        return ok([{ ...next, focusedProfileId }, undefined]);
      });
    },

    activateProfile(profileId: string): MutationResult<void> {
      return commit((doc) => {
        if (findProfile(doc, profileId) === undefined) {
          return notFound();
        }
        return ok([
          {
            ...doc,
            focusedProfileId: profileId,
            profiles: doc.profiles.map((profile) => ({
              ...profile,
              enabled: profile.id === profileId,
            })),
          },
          undefined,
        ]);
      });
    },

    setProfileBadge(
      profileId: string,
      badge: { badgeText: string; color: BadgeColor },
    ): MutationResult<void> {
      return commit((doc) => {
        if (findProfile(doc, profileId) === undefined) {
          return notFound();
        }
        return ok([
          withProfile(doc, profileId, (profile) => ({
            ...profile,
            badgeText: normalizeBadgeText(badge.badgeText),
            color: badge.color,
          })),
          undefined,
        ]);
      });
    },

    setPaused(paused: boolean): MutationResult<void> {
      return updateSettings({ paused });
    },

    setTheme(theme: Settings["theme"]): MutationResult<void> {
      return updateSettings({ theme });
    },

    setBadgeMode(badgeMode: Settings["badgeMode"]): MutationResult<void> {
      return updateSettings({ badgeMode });
    },

    applyImport(plan: ImportPlan): MutationResult<void> {
      return commit((doc) => {
        // The plan's names were reserved against the doc at plan time; another
        // context may have claimed one since, so rebase inside the lock.
        const profiles: ImportedProfile[] = [];
        for (const profile of plan.profiles) {
          profiles.push({
            ...profile,
            name: availableProfileName(profile.name, doc.profiles, profiles),
          });
        }
        return ok([applyImportPlan(doc, { ...plan, profiles }), undefined]);
      });
    },
  };

  function updateSettings(patch: Partial<Settings>): MutationResult<void> {
    return commit((doc) =>
      ok([{ ...doc, settings: { ...doc.settings, ...patch } }, undefined]),
    );
  }
}

async function sanitizeDraft(
  draft: RuleDraft,
  validateRegex: RegexValidator,
): Promise<Result<RuleDraft, MutationError>> {
  const header = validateHeader({
    direction: draft.direction,
    operation: draft.operation,
    header: draft.header,
    ...(draft.value === undefined ? {} : { value: draft.value }),
  });
  if (!header.ok) {
    return header;
  }
  const scope = normalizeScope(draft.scope);
  if (!scope.ok) {
    return scope;
  }
  const resourceTypes = normalizeResourceTypes(draft.resourceTypes);
  if (!resourceTypes.ok) {
    return resourceTypes;
  }
  // Regex scopes are validated before save regardless of the enabled flag
  // (SPEC §2.3); the commit guard only re-checks rules entering the enabled set.
  if (scope.value.type === "regex") {
    const supported = await validateRegex(scope.value.regex);
    if (!supported.ok) {
      return err({
        kind: "regex-invalid",
        regex: scope.value.regex,
        reason: supported.error,
      } as const);
    }
  }

  const comment = draft.comment?.trim();
  return ok({
    direction: draft.direction,
    operation: draft.operation,
    header: header.value.header,
    ...(header.value.value === undefined ? {} : { value: header.value.value }),
    scope: scope.value,
    resourceTypes: resourceTypes.value,
    initiators: normalizeHosts(draft.initiators),
    enabled: draft.enabled,
    ...(comment === undefined || comment.length === 0 ? {} : { comment }),
    // A remove rule has no value, so generated-value metadata cannot apply.
    ...(draft.generated === undefined || draft.operation === "remove"
      ? {}
      : { generated: { ...draft.generated } }),
  });
}

function normalizeScope(scope: Scope): Result<Scope, MutationError> {
  switch (scope.type) {
    case "domains": {
      const domains = normalizeHosts(scope.domains);
      return domains.length === 0
        ? err({ kind: "scope-empty" } as const)
        : ok({ type: "domains", domains });
    }
    case "pattern": {
      const pattern = scope.pattern.trim();
      if (pattern.length === 0) {
        return err({ kind: "scope-empty" } as const);
      }
      const grammar = validateUrlFilter(pattern);
      if (!grammar.ok) {
        return err({
          kind: "pattern-invalid",
          pattern,
          reason: grammar.error,
        } as const);
      }
      return ok({
        type: "pattern",
        pattern,
        hosts: normalizeHosts(scope.hosts),
      });
    }
    case "regex":
      return scope.regex.trim().length === 0
        ? err({ kind: "scope-empty" } as const)
        : ok({
            type: "regex",
            regex: scope.regex,
            hosts: normalizeHosts(scope.hosts),
          });
    case "all":
      return ok({ type: "all" });
  }
}

function normalizeResourceTypes(
  resourceTypes: Rule["resourceTypes"],
): Result<Rule["resourceTypes"], MutationError> {
  if (resourceTypes === "all") {
    return ok("all");
  }
  const groups = [...new Set(resourceTypes)];
  // The resource-type set is a scope dimension (SPEC §2.3); a rule that
  // applies to no resource type has an empty scope.
  return groups.length === 0
    ? err({ kind: "scope-empty" } as const)
    : ok(groups);
}

function normalizeHosts(hosts: readonly string[]): string[] {
  return [
    ...new Set(
      hosts
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0),
    ),
  ];
}

function enabledRules(doc: StateDoc): Rule[] {
  return doc.profiles
    .filter((profile) => profile.enabled)
    .flatMap((profile) => profile.rules.filter((rule) => rule.enabled));
}

function regexCount(rules: readonly Rule[]): number {
  return rules.filter((rule) => rule.scope.type === "regex").length;
}

function findProfile(doc: StateDoc, profileId: string): Profile | undefined {
  return doc.profiles.find((profile) => profile.id === profileId);
}

function findRule(
  doc: StateDoc,
  profileId: string,
  ruleId: string,
): Rule | undefined {
  return findProfile(doc, profileId)?.rules.find((rule) => rule.id === ruleId);
}

function withProfile(
  doc: StateDoc,
  profileId: string,
  update: (profile: Profile) => Profile,
): StateDoc {
  return {
    ...doc,
    profiles: doc.profiles.map((profile) =>
      profile.id === profileId ? update(profile) : profile,
    ),
  };
}

function withRules(
  doc: StateDoc,
  profileId: string,
  update: (rules: readonly Rule[]) => Rule[],
): StateDoc {
  return withProfile(doc, profileId, (profile) => ({
    ...profile,
    rules: update(profile.rules),
  }));
}

function insertAt<T>(list: readonly T[], item: T, index: number): T[] {
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, list.length)), 0, item);
  return next;
}

function topmostFocus(profiles: readonly Profile[]): string {
  const target = profiles.find((profile) => profile.enabled) ?? profiles[0];
  if (target === undefined) {
    throw new Error("state document has no profiles");
  }
  return target.id;
}

function defaultBadgeText(name: string): string {
  // Default badge text is the name's first two significant characters,
  // uppercased to match the seeded Default profile's initials style.
  return normalizeBadgeText(name.replace(/\s+/g, "")).toUpperCase();
}

function cloneName(base: string, profiles: readonly Profile[]): string {
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? " copy" : ` copy ${n}`;
    const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
    if (isProfileNameAvailable(profiles, candidate)) {
      return candidate;
    }
  }
}

function notFound(): Result<never, MutationError> {
  return err({ kind: "not-found" } as const);
}
