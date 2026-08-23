import { headerSensitivity, normalizeHeaderName } from "../headers";
import {
  availableProfileName,
  BADGE_COLORS,
  type BadgeColor,
  createProfile,
  createRule,
  DIRECTIONS,
  type Direction,
  deriveBadgeText,
  HEADER_OPERATIONS,
  type HeaderOp,
  isStoredProfileNameValid,
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
  readonly rules: readonly ExportedRule[];
}

export interface HeadershimEnvelope {
  readonly app: "headershim";
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly profiles: readonly ExportedProfile[];
}

export interface ImportedProfile {
  readonly name: string;
  readonly badgeText: string;
  readonly color: BadgeColor;
  readonly rules: readonly RuleDraft[];
}

interface ImportWarning {
  readonly kind: string;
  readonly ruleName: string;
}

export interface ImportPlan<Warning extends ImportWarning = ImportWarning> {
  readonly profiles: readonly ImportedProfile[];
  readonly warnings: readonly Warning[];
}

/**
 * A rule the import review must not let pass unread: one that carries a
 * credential, or one that takes away a protection the site sent. Both codecs
 * emit these, so a file reviews the same however it was authored.
 */
export interface SensitiveRuleWarning {
  readonly kind: "credential" | "security-response";
  readonly ruleName: string;
  readonly header: string;
}

export type ImportError =
  | { readonly kind: "parse-failure" }
  | {
      readonly kind: "newer-version";
      readonly foundVersion: number;
      readonly supportedVersion: typeof CURRENT_SCHEMA_VERSION;
    }
  | { readonly kind: "unrecognized-format" }
  | { readonly kind: "invalid-export" }
  | ({
      readonly kind: "invalid-rule";
      readonly profileName: string;
      /** The rule's place in its profile, counted the way the file reads. */
      readonly ruleNumber: number;
    } & RuleFault);

type EnvelopeMigrationError = Extract<
  ImportError,
  { kind: "newer-version" | "invalid-export" | "invalid-rule" }
>;

interface RuleFault {
  /** The first field that failed, absent when the rule is not a record. */
  readonly field?: string;
}

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
  parsed: unknown,
  existingProfiles: readonly Profile[],
): Result<ImportPlan<SensitiveRuleWarning>, ImportError> {
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
  if (!isRecord(envelope)) {
    return err({ kind: "invalid-export" });
  }

  const version = versionOf(envelope);
  if (version === undefined) {
    return err({ kind: "invalid-export" });
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return err({
      kind: "newer-version",
      foundVersion: version,
      supportedVersion: CURRENT_SCHEMA_VERSION,
    });
  }

  return isHeadershimEnvelope(envelope)
    ? ok(envelope)
    : err(envelopeFault(envelope));
}

export function applyImportPlan(doc: StateDoc, plan: ImportPlan): StateDoc {
  let nextDoc = doc;

  for (const importedProfile of plan.profiles) {
    // The badge is the only mark that tells one profile's rules from another's
    // in the rule lists, so an imported one that a profile already wears is
    // re-derived from the name the import landed under, the same way a created
    // profile takes one.
    const taken = nextDoc.profiles.map((profile) => profile.badgeText);
    const profile = createProfile({
      name: importedProfile.name,
      badgeText: taken.includes(importedProfile.badgeText)
        ? deriveBadgeText(importedProfile.name, taken)
        : importedProfile.badgeText,
      color: importedProfile.color,
    });
    const rules = [];

    for (const imported of importedProfile.rules) {
      const [rule, allocatedDoc] = createRule(nextDoc, imported);
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
): ImportPlan<SensitiveRuleWarning> {
  const profiles: ImportedProfile[] = [];

  for (const exported of envelope.profiles) {
    profiles.push({
      name: availableProfileName(
        exported.name,
        existingProfiles,
        profiles.map((profile) => profile.name),
      ),
      badgeText: exported.badge,
      color: exported.color,
      rules: exported.rules.map(importRuleDraft),
    });
  }

  return { profiles, warnings: sensitiveRuleWarnings(profiles) };
}

/**
 * Every sensitive rule in a plan, itemized by the name the summary shows it
 * under. Reads `headerSensitivity`, the same classifier the editor's advisory
 * band reads, so the review and the editor cannot disagree about what is
 * sensitive.
 */
export function sensitiveRuleWarnings(
  profiles: readonly ImportedProfile[],
): readonly SensitiveRuleWarning[] {
  return profiles.flatMap((profile) =>
    profile.rules.flatMap((rule) =>
      headerSensitivity(rule).map((advisory) => ({
        kind: advisory.kind,
        ruleName: draftRuleName(rule),
        header: rule.header,
      })),
    ),
  );
}

/**
 * The name a plan's rule is itemized under. The header is what the warning is
 * about and is one short token; a comment is free text of any length and drops
 * three lines of prose into a label slot.
 */
function draftRuleName(rule: RuleDraft): string {
  return rule.header;
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

function versionOf(value: Record<string, unknown>): number | undefined {
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
    isTimestamp(exportedAt) &&
    Array.isArray(profiles) &&
    profiles.every(isExportedProfile)
  );
}

// Permissive by design: exports live in git and get hand-edited in review, so
// any parseable timestamp is acceptable metadata.
function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isExportedProfile(value: unknown): value is ExportedProfile {
  if (!isRecord(value)) {
    return false;
  }

  const { name, badge, color, rules } = value;
  return (
    typeof name === "string" &&
    isStoredProfileNameValid([], name) &&
    typeof badge === "string" &&
    normalizeBadgeText(badge) === badge &&
    isOneOf(color, BADGE_COLORS) &&
    Array.isArray(rules) &&
    rules.every(isExportedRule)
  );
}

function isExportedRule(value: unknown): value is ExportedRule {
  return ruleFault(value) === undefined;
}

/**
 * The first field of an exported rule that fails, or undefined when the rule is
 * one this version can read. It is the single reading of a rule's shape: the
 * guard above and the error that places a fault in the file are both this
 * function, so a rule cannot be refused for a reason it is not told.
 */
function ruleFault(value: unknown): RuleFault | undefined {
  if (!isRecord(value)) {
    return {};
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
  if (!isOneOf(direction, DIRECTIONS)) return { field: "direction" };
  if (!isOneOf(operation, HEADER_OPERATIONS)) return { field: "operation" };
  if (
    typeof header !== "string" ||
    header.length === 0 ||
    header !== normalizeHeaderName(header)
  ) {
    return { field: "header" };
  }
  if (!hasValidHeaderValue(value)) return { field: "value" };
  if (comment !== undefined && typeof comment !== "string") {
    return { field: "comment" };
  }
  if (typeof enabled !== "boolean") return { field: "enabled" };
  if (!isExportedScope(scope)) return { field: "scope" };
  if (!isStringArray(initiators)) return { field: "initiators" };
  if (generated !== undefined && !isGeneratedValue(generated)) {
    return { field: "generated" };
  }
  return undefined;
}

/**
 * Why a recognized envelope was refused. A rule this version cannot read is
 * reported where it sits, so the file has an address to fix; a fault in the
 * envelope around the rules has none to give.
 */
function envelopeFault(
  envelope: Record<string, unknown>,
): EnvelopeMigrationError {
  const { profiles } = envelope;
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!isRecord(profile)) continue;
    const { name, rules } = profile;
    if (
      typeof name !== "string" ||
      !isStoredProfileNameValid([], name) ||
      !Array.isArray(rules)
    ) {
      continue;
    }
    for (const [index, rule] of rules.entries()) {
      const fault = ruleFault(rule);
      if (fault !== undefined) {
        return {
          kind: "invalid-rule",
          profileName: name,
          ruleNumber: index + 1,
          ...fault,
        };
      }
    }
  }
  return { kind: "invalid-export" };
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
