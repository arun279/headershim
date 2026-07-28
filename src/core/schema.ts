import { normalizeHeaderName } from "./headers";
import {
  createDefaultProfile,
  isNormalizedBadgeText,
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

export function migrate(doc: unknown): Result<StateDoc, MigrationError> {
  const version = versionOf(doc);
  if (version === undefined) {
    return err({ kind: "corrupt" });
  }
  if (version > CURRENT) {
    return err({ kind: "newer-store", foundVersion: version });
  }

  const repaired = repairActiveProfile(doc);
  if (!isStateDoc(repaired)) {
    return err({ kind: "corrupt" });
  }
  return ok(repaired);
}

// There is always exactly one active profile. An activeProfileId that names no
// stored profile (a value written by an earlier build that allowed none active,
// or a deleted profile) is repaired to the first profile before validation.
function repairActiveProfile(doc: unknown): unknown {
  if (!isRecord(doc)) {
    return doc;
  }
  const { profiles, activeProfileId } = doc;
  if (!Array.isArray(profiles)) {
    return doc;
  }
  const ids = profiles.filter(isRecord).map(({ id }) => id);
  if (ids.includes(activeProfileId)) {
    return doc;
  }
  const [first] = ids;
  return typeof first === "string" ? { ...doc, activeProfileId: first } : doc;
}

export function createV1Seed(): StateDoc {
  const profile = createDefaultProfile();

  return {
    v: CURRENT,
    profiles: [profile],
    activeProfileId: profile.id,
    nextRuleNum: 1,
    settings: {
      paused: false,
      theme: "system",
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

  const {
    v,
    profiles,
    activeProfileId,
    previousProfileId,
    nextRuleNum,
    settings,
  } = value;
  if (
    v !== CURRENT ||
    !Array.isArray(profiles) ||
    profiles.length === 0 ||
    !profiles.every(isProfile) ||
    typeof activeProfileId !== "string" ||
    (previousProfileId !== undefined &&
      typeof previousProfileId !== "string") ||
    typeof nextRuleNum !== "number" ||
    !Number.isSafeInteger(nextRuleNum) ||
    nextRuleNum < 1 ||
    !isSettings(settings)
  ) {
    return false;
  }

  const profileIds = profiles.map(({ id }) => id);
  const profileNames = profiles.map(({ name }) => name.toLowerCase());
  const rules = profiles.flatMap(({ rules: profileRules }) => profileRules);
  const ruleIds = rules.map(({ id }) => id);
  const ruleNums = rules.map(({ num }) => num);

  return (
    hasUniqueValues(profileIds) &&
    hasUniqueValues(profileNames) &&
    hasUniqueValues(ruleIds) &&
    hasUniqueValues(ruleNums) &&
    ruleNums.every((num) => num < nextRuleNum)
  );
}

function isProfile(value: unknown): value is Profile {
  if (!isRecord(value)) {
    return false;
  }

  const { id, name, badgeText, color, rules } = value;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    typeof name === "string" &&
    name.trim().length > 0 &&
    typeof badgeText === "string" &&
    isNormalizedBadgeText(badgeText) &&
    isOneOf(color, BADGE_COLORS) &&
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
    header === normalizeHeaderName(header) &&
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

  const { paused, theme } = value;
  return (
    typeof paused === "boolean" &&
    (theme === "system" || theme === "light" || theme === "dark")
  );
}

function hasUniqueValues<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}
