import {
  type BadgeColor,
  createProfile,
  type Direction,
  type HeaderOp,
  importRule,
  isProfileNameAvailable,
  normalizeBadgeText,
  type Profile,
  type ResourceGroup,
  type Rule,
  type RuleDraft,
  type Scope,
  type StateDoc,
} from "../model";
import { err, ok, type Result } from "../result";
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
} from "../validation";
import { detectImportFormat } from "./detect";

export const CURRENT_SCHEMA_VERSION = 1;

interface ExportedScope {
  readonly type: Scope["type"];
  readonly domains?: readonly string[];
  readonly pattern?: string;
  readonly regex?: string;
  readonly hosts?: readonly string[];
  readonly resourceTypes: readonly ResourceGroup[] | "all";
}

interface ExportedRule {
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  readonly value?: string;
  readonly comment?: string;
  readonly enabled: boolean;
  readonly scope: ExportedScope;
  readonly initiators: readonly string[];
  readonly generated?: Rule["generated"];
}

interface ExportedProfile {
  readonly name: string;
  readonly badge: string;
  readonly color: BadgeColor;
  readonly enabled: boolean;
  readonly rules: readonly ExportedRule[];
}

export interface HeadershimEnvelope {
  readonly app: "headershim";
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly profiles: readonly ExportedProfile[];
}

interface ImportedProfile {
  readonly name: string;
  readonly badgeText: string;
  readonly color: BadgeColor;
  readonly enabled: false;
  readonly rules: readonly RuleDraft[];
}

interface ImportWarning {
  readonly kind: string;
  readonly ruleName: string;
}

export interface ImportPlan {
  readonly profiles: readonly ImportedProfile[];
  readonly warnings: readonly ImportWarning[];
}

export type ImportError =
  | { readonly kind: "parse-failure" }
  | {
      readonly kind: "newer-version";
      readonly foundVersion: number;
      readonly supportedVersion: typeof CURRENT_SCHEMA_VERSION;
    }
  | { readonly kind: "unrecognized-format" }
  | { readonly kind: "invalid-export" };

type EnvelopeMigrationError = Extract<
  ImportError,
  { kind: "newer-version" | "invalid-export" }
>;
type MigrationStep = (
  envelope: unknown,
) => Result<unknown, EnvelopeMigrationError>;

export const migrations: Readonly<Partial<Record<number, MigrationStep>>> = {};

export function createHeadershimEnvelope(
  source: StateDoc | Profile,
  exportedAt = new Date(),
): HeadershimEnvelope {
  return {
    app: "headershim",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    profiles: ("v" in source ? source.profiles : [source]).map(exportProfile),
  };
}

export function exportHeadershim(
  source: StateDoc | Profile,
  exportedAt = new Date(),
): string {
  return `${JSON.stringify(createHeadershimEnvelope(source, exportedAt), null, 2)}\n`;
}

export function importHeadershim(
  raw: string,
  existingProfiles: readonly Profile[],
): Result<ImportPlan, ImportError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ kind: "parse-failure" });
  }

  if (detectImportFormat(parsed) !== "headershim") {
    return err({ kind: "unrecognized-format" });
  }

  const migrated = migrate(parsed);
  if (!migrated.ok) {
    return err(migrated.error);
  }

  return ok(createImportPlan(migrated.value, existingProfiles));
}

export function migrate(
  envelope: unknown,
): Result<HeadershimEnvelope, EnvelopeMigrationError> {
  const initialVersion = versionOf(envelope);
  if (initialVersion === undefined) {
    return err({ kind: "invalid-export" });
  }
  if (initialVersion > CURRENT_SCHEMA_VERSION) {
    return err({
      kind: "newer-version",
      foundVersion: initialVersion,
      supportedVersion: CURRENT_SCHEMA_VERSION,
    });
  }

  let migrated = envelope;
  let version = initialVersion;
  // The initial envelope schema has no predecessor that can exercise this chain yet.
  /* v8 ignore start */
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) {
      return err({ kind: "invalid-export" });
    }

    const result = step(migrated);
    if (!result.ok) {
      return result;
    }

    const nextVersion = versionOf(result.value);
    if (!(nextVersion !== undefined && nextVersion > version)) {
      return err({ kind: "invalid-export" });
    }
    if (nextVersion > CURRENT_SCHEMA_VERSION) {
      return err({
        kind: "newer-version",
        foundVersion: nextVersion,
        supportedVersion: CURRENT_SCHEMA_VERSION,
      });
    }

    migrated = result.value;
    version = nextVersion;
  }
  /* v8 ignore stop */

  return isHeadershimEnvelope(migrated)
    ? ok(migrated)
    : err({ kind: "invalid-export" });
}

export function applyImportPlan(doc: StateDoc, plan: ImportPlan): StateDoc {
  let nextDoc = doc;

  for (const importedProfile of plan.profiles) {
    const profile = createProfile({
      name: importedProfile.name,
      badgeText: importedProfile.badgeText,
      color: importedProfile.color,
      enabled: false,
    });
    const rules = [];

    for (const imported of importedProfile.rules) {
      const [rule, allocatedDoc] = importRule(nextDoc, imported);
      rules.push(rule);
      nextDoc = allocatedDoc;
    }

    nextDoc = {
      ...nextDoc,
      profiles: [...nextDoc.profiles, { ...profile, rules }],
    };
  }

  return nextDoc;
}

function exportProfile(profile: Profile): ExportedProfile {
  return {
    name: profile.name,
    badge: profile.badgeText,
    color: profile.color,
    enabled: profile.enabled,
    rules: profile.rules.map(exportRule),
  };
}

function exportRule(rule: Rule): ExportedRule {
  return {
    direction: rule.direction,
    operation: rule.operation,
    header: rule.header,
    ...(rule.value === undefined ? {} : { value: rule.value }),
    ...(rule.comment === undefined ? {} : { comment: rule.comment }),
    enabled: rule.enabled,
    scope: exportScope(rule.scope, rule.resourceTypes),
    initiators: [...rule.initiators],
    ...(rule.generated === undefined
      ? {}
      : { generated: { ...rule.generated } }),
  };
}

function exportScope(
  scope: Scope,
  resourceTypes: Rule["resourceTypes"],
): ExportedScope {
  switch (scope.type) {
    case "domains":
      return {
        type: "domains",
        domains: [...scope.domains],
        resourceTypes: copyResourceTypes(resourceTypes),
      };
    case "pattern":
      return {
        type: "pattern",
        pattern: scope.pattern,
        hosts: [...scope.hosts],
        resourceTypes: copyResourceTypes(resourceTypes),
      };
    case "regex":
      return {
        type: "regex",
        regex: scope.regex,
        hosts: [...scope.hosts],
        resourceTypes: copyResourceTypes(resourceTypes),
      };
    case "all":
      return { type: "all", resourceTypes: copyResourceTypes(resourceTypes) };
  }
}

function createImportPlan(
  envelope: HeadershimEnvelope,
  existingProfiles: readonly Profile[],
): ImportPlan {
  const profiles: ImportedProfile[] = [];

  for (const exported of envelope.profiles) {
    profiles.push({
      name: availableProfileName(exported.name, existingProfiles, profiles),
      badgeText: exported.badge,
      color: exported.color,
      enabled: false,
      rules: exported.rules.map(importRuleDraft),
    });
  }

  return { profiles, warnings: [] };
}

function importRuleDraft(rule: ExportedRule): RuleDraft {
  return {
    direction: rule.direction,
    operation: rule.operation,
    header: rule.header,
    ...(rule.value === undefined ? {} : { value: rule.value }),
    scope: importScope(rule.scope),
    resourceTypes: copyResourceTypes(rule.scope.resourceTypes),
    initiators: [...rule.initiators],
    enabled: rule.enabled,
    ...(rule.comment === undefined ? {} : { comment: rule.comment }),
    ...(rule.generated === undefined
      ? {}
      : { generated: { ...rule.generated } }),
  };
}

function importScope(scope: ExportedScope): Scope {
  switch (scope.type) {
    case "domains":
      return { type: "domains", domains: [...(scope.domains ?? [])] };
    case "pattern":
      return {
        type: "pattern",
        pattern: scope.pattern ?? "",
        hosts: [...(scope.hosts ?? [])],
      };
    case "regex":
      return {
        type: "regex",
        regex: scope.regex ?? "",
        hosts: [...(scope.hosts ?? [])],
      };
    case "all":
      return { type: "all" };
  }
}

function availableProfileName(
  base: string,
  existingProfiles: readonly Profile[],
  plannedProfiles: readonly ImportedProfile[],
): string {
  if (isAvailable(base, existingProfiles, plannedProfiles)) {
    return base;
  }

  for (let suffix = 2; ; suffix += 1) {
    const ending = ` ${suffix}`;
    const candidate = `${base.slice(0, 48 - ending.length).trimEnd()}${ending}`;
    if (isAvailable(candidate, existingProfiles, plannedProfiles)) {
      return candidate;
    }
  }
}

function isAvailable(
  candidate: string,
  existingProfiles: readonly Profile[],
  plannedProfiles: readonly ImportedProfile[],
): boolean {
  const normalized = candidate.toLowerCase();
  return (
    isProfileNameAvailable(existingProfiles, candidate) &&
    plannedProfiles.every(
      (profile) => profile.name.toLowerCase() !== normalized,
    )
  );
}

function versionOf(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { schemaVersion } = value;
  return typeof schemaVersion === "number" &&
    Number.isSafeInteger(schemaVersion) &&
    schemaVersion >= 1
    ? schemaVersion
    : undefined;
}

function isHeadershimEnvelope(value: unknown): value is HeadershimEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  const { app, schemaVersion, exportedAt, profiles } = value;
  return (
    app === "headershim" &&
    schemaVersion === CURRENT_SCHEMA_VERSION &&
    isIsoTimestamp(exportedAt) &&
    Array.isArray(profiles) &&
    profiles.every(isExportedProfile)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const milliseconds = Date.parse(value);
  return (
    !Number.isNaN(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isExportedProfile(value: unknown): value is ExportedProfile {
  if (!isRecord(value)) {
    return false;
  }

  const { name, badge, color, enabled, rules } = value;
  return (
    typeof name === "string" &&
    isProfileNameAvailable([], name) &&
    typeof badge === "string" &&
    normalizeBadgeText(badge) === badge &&
    isOneOf(color, BADGE_COLORS) &&
    typeof enabled === "boolean" &&
    Array.isArray(rules) &&
    rules.every(isExportedRule)
  );
}

function isExportedRule(value: unknown): value is ExportedRule {
  if (!isRecord(value)) {
    return false;
  }

  const {
    direction,
    operation,
    header,
    comment,
    enabled,
    scope,
    initiators,
    generated,
  } = value;
  return (
    isOneOf(direction, DIRECTIONS) &&
    isOneOf(operation, HEADER_OPERATIONS) &&
    typeof header === "string" &&
    header.length > 0 &&
    header === header.trim().toLowerCase() &&
    hasValidHeaderValue(value) &&
    (comment === undefined || typeof comment === "string") &&
    typeof enabled === "boolean" &&
    isExportedScope(scope) &&
    isStringArray(initiators) &&
    (generated === undefined || isGeneratedValue(generated))
  );
}

function isExportedScope(value: unknown): value is ExportedScope {
  if (!isRecord(value)) {
    return false;
  }
  const { resourceTypes } = value;
  return isScope(value) && isResourceTypes(resourceTypes);
}

function copyResourceTypes(
  resourceTypes: readonly ResourceGroup[] | "all",
): ResourceGroup[] | "all" {
  return resourceTypes === "all" ? "all" : [...resourceTypes];
}
