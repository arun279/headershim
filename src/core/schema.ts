import {
  createProfile,
  isProfileNameAvailable,
  normalizeBadgeText,
  type Profile,
  type Rule,
  type Settings,
  type StateDoc,
} from "./model";
import { err, ok, type Result } from "./result";
import {
  BADGE_COLORS,
  DIRECTIONS,
  HEADER_OPERATIONS,
  hasValidHeaderValue,
  isGeneratedValue,
  isOneOf,
  isRecord,
  isResourceTypes,
  isScope,
  isStringArray,
} from "./validation";

export const CURRENT: StateDoc["v"] = 1;

export type MigrationError =
  | { readonly kind: "corrupt" }
  | { readonly kind: "newer-store"; readonly foundVersion: number };

type MigrationStep = (doc: unknown) => Result<unknown, MigrationError>;

export const migrations: Readonly<Partial<Record<number, MigrationStep>>> = {};

export function migrate(doc: unknown): Result<StateDoc, MigrationError> {
  const initialVersion = versionOf(doc);
  if (initialVersion === undefined) {
    return err({ kind: "corrupt" });
  }
  if (initialVersion > CURRENT) {
    return err({ kind: "newer-store", foundVersion: initialVersion });
  }

  let migrated = doc;
  let version = initialVersion;
  // The initial schema has no predecessor that can exercise this chain yet.
  /* v8 ignore start */
  while (version < CURRENT) {
    const step = migrations[version];
    if (step === undefined) {
      return err({ kind: "corrupt" });
    }

    const result = step(migrated);
    if (!result.ok) {
      return err(result.error);
    }

    const nextVersion = versionOf(result.value);
    if (nextVersion === undefined || nextVersion <= version) {
      return err({ kind: "corrupt" });
    }
    if (nextVersion > CURRENT) {
      return err({ kind: "newer-store", foundVersion: nextVersion });
    }

    migrated = result.value;
    version = nextVersion;
  }
  /* v8 ignore stop */

  return isStateDoc(migrated) ? ok(migrated) : err({ kind: "corrupt" });
}

export function createV1Seed(): StateDoc {
  const profile = createProfile({
    name: "Default",
    badgeText: "DE",
    color: "indigo",
    enabled: true,
  });

  return {
    v: CURRENT,
    profiles: [profile],
    focusedProfileId: profile.id,
    nextRuleNum: 1,
    settings: {
      paused: false,
      theme: "system",
      badgeMode: "count",
    },
  };
}

function versionOf(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { v: version } = value;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return undefined;
  }
  return version;
}

function isStateDoc(value: unknown): value is StateDoc {
  if (!isRecord(value)) {
    return false;
  }

  const { v, profiles, focusedProfileId, nextRuleNum, settings } = value;
  if (
    v !== CURRENT ||
    !Array.isArray(profiles) ||
    profiles.length === 0 ||
    !profiles.every(isProfile) ||
    typeof focusedProfileId !== "string" ||
    typeof nextRuleNum !== "number" ||
    !Number.isSafeInteger(nextRuleNum) ||
    nextRuleNum < 1 ||
    !isSettings(settings)
  ) {
    return false;
  }

  const profileIds = profiles.map(({ id }) => id);
  const rules = profiles.flatMap(({ rules: profileRules }) => profileRules);
  const ruleIds = rules.map(({ id }) => id);
  const ruleNums = rules.map(({ num }) => num);

  return (
    hasUniqueValues(profileIds) &&
    profileIds.includes(focusedProfileId) &&
    profiles.every((profile) =>
      isProfileNameAvailable(profiles, profile.name, profile.id),
    ) &&
    hasUniqueValues(ruleIds) &&
    hasUniqueValues(ruleNums) &&
    ruleNums.every((num) => num < nextRuleNum)
  );
}

function isProfile(value: unknown): value is Profile {
  if (!isRecord(value)) {
    return false;
  }

  const { id, name, badgeText, color, enabled, rules } = value;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    typeof name === "string" &&
    isProfileNameAvailable([], name) &&
    typeof badgeText === "string" &&
    normalizeBadgeText(badgeText) === badgeText &&
    isOneOf(color, BADGE_COLORS) &&
    typeof enabled === "boolean" &&
    Array.isArray(rules) &&
    rules.every(isRule)
  );
}

function isRule(value: unknown): value is Rule {
  if (!isRecord(value)) {
    return false;
  }

  const {
    id,
    num,
    direction,
    operation,
    header,
    scope,
    resourceTypes,
    initiators,
    enabled,
    comment,
    generated,
  } = value;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    typeof num === "number" &&
    Number.isSafeInteger(num) &&
    num > 0 &&
    isOneOf(direction, DIRECTIONS) &&
    isOneOf(operation, HEADER_OPERATIONS) &&
    typeof header === "string" &&
    header.length > 0 &&
    header === header.trim().toLowerCase() &&
    hasValidHeaderValue(value) &&
    isScope(scope) &&
    isResourceTypes(resourceTypes) &&
    isStringArray(initiators) &&
    typeof enabled === "boolean" &&
    (comment === undefined || typeof comment === "string") &&
    (generated === undefined || isGeneratedValue(generated))
  );
}

function isSettings(value: unknown): value is Settings {
  if (!isRecord(value)) {
    return false;
  }

  const { paused, theme, badgeMode } = value;
  return (
    typeof paused === "boolean" &&
    (theme === "system" || theme === "light" || theme === "dark") &&
    (badgeMode === "count" || badgeMode === "initials")
  );
}

function hasUniqueValues<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}
