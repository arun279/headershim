import { classifyHeaderName, normalizeHeaderName } from "../headers";
import type {
  BadgeColor,
  HeaderOp,
  Profile,
  ResourceGroup,
  RuleDraft,
  Scope,
} from "../model";
import { err, ok, type Result } from "../result";
import { BADGE_COLORS, isRecord } from "../validation";
import { detectImportFormat } from "./detect";
import {
  availableProfileName,
  type ImportError,
  type ImportedProfile,
  type ImportPlan,
} from "./headershim";

const PROFILE_ARRAY_FIELDS = [
  "headers",
  "respHeaders",
  "cookieHeaders",
  "setCookieHeaders",
  "cspHeaders",
  "urlFilters",
  "resourceFilters",
  "excludeUrlFilters",
  "initiatorDomainFilters",
  "tabFilters",
  "tabGroupFilters",
  "windowFilters",
  "timeFilters",
  "urlReplacements",
] as const;

const BADGE_PALETTE = {
  indigo: "#4f5bc4",
  blue: "#1a6bc7",
  teal: "#0b7285",
  green: "#1d7a46",
  plum: "#7a3fb5",
  magenta: "#b03a78",
  crimson: "#c03538",
  slate: "#46586b",
} as const satisfies Record<BadgeColor, string>;

const DROPPED_FILTER_FIELDS = [
  ["excludeUrlFilters", "exclude-url-filter-dropped"],
  ["initiatorDomainFilters", "initiator-domain-filter-dropped"],
  ["tabFilters", "tab-filter-dropped"],
  ["tabGroupFilters", "tab-group-filter-dropped"],
  ["windowFilters", "window-filter-dropped"],
  ["timeFilters", "time-filter-dropped"],
  ["urlReplacements", "url-replacement-dropped"],
] as const;

interface ModHeaderProfile {
  readonly title: string;
  readonly shortTitle?: string;
  readonly backgroundColor?: string;
  readonly headers?: readonly Record<string, unknown>[];
  readonly respHeaders?: readonly Record<string, unknown>[];
  readonly cookieHeaders?: readonly Record<string, unknown>[];
  readonly setCookieHeaders?: readonly Record<string, unknown>[];
  readonly cspHeaders?: readonly Record<string, unknown>[];
  readonly urlFilters?: readonly Record<string, unknown>[];
  readonly resourceFilters?: readonly Record<string, unknown>[];
  readonly excludeUrlFilters?: readonly Record<string, unknown>[];
  readonly initiatorDomainFilters?: readonly Record<string, unknown>[];
  readonly tabFilters?: readonly Record<string, unknown>[];
  readonly tabGroupFilters?: readonly Record<string, unknown>[];
  readonly windowFilters?: readonly Record<string, unknown>[];
  readonly timeFilters?: readonly Record<string, unknown>[];
  readonly urlReplacements?: readonly Record<string, unknown>[];
}

interface SourceRule {
  readonly enabled: boolean;
  readonly name: string;
  readonly value?: string;
  readonly comment?: string;
  readonly operation: HeaderOp;
}

interface RuleMapping {
  readonly rule: RuleDraft;
  readonly ruleName: string;
  readonly warnings: readonly ModHeaderImportWarning[];
}

type DroppedWarningKind =
  | "exclude-url-filter-dropped"
  | "initiator-domain-filter-dropped"
  | "tab-filter-dropped"
  | "tab-group-filter-dropped"
  | "window-filter-dropped"
  | "time-filter-dropped"
  | "url-replacement-dropped";

export type ModHeaderImportWarning =
  | {
      readonly kind: "request-append-degraded";
      readonly ruleName: string;
      readonly header: string;
    }
  | {
      readonly kind:
        | "cookie-semantics-degraded"
        | "set-cookie-semantics-degraded"
        | "csp-semantics-degraded";
      readonly ruleName: string;
    }
  | {
      readonly kind: "invalid-regex";
      readonly ruleName: string;
      readonly pattern: string;
    }
  | {
      readonly kind: DroppedWarningKind;
      readonly ruleName: string;
      readonly value: string;
    }
  | {
      readonly kind: "dynamic-token";
      readonly ruleName: string;
      readonly tokens: readonly string[];
      readonly conversionOffer?: {
        readonly kind: "convert-to-frozen-value";
        readonly tokens: readonly ("uuid" | "timestamp")[];
      };
    };

export type RegexValidator = (regex: string) => Promise<Result<void, unknown>>;

export async function importModHeader(
  raw: string,
  existingProfiles: readonly Profile[],
  validateRegex: RegexValidator,
): Promise<Result<ImportPlan<ModHeaderImportWarning>, ImportError>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ kind: "parse-failure" });
  }

  if (detectImportFormat(parsed) !== "modheader") {
    return err({ kind: "unrecognized-format" });
  }
  if (!isModHeaderExport(parsed)) {
    return err({ kind: "invalid-export" });
  }

  const profiles: ImportedProfile[] = [];
  const warnings: ModHeaderImportWarning[] = [];
  for (const source of parsed) {
    const mapped = await mapProfile(
      source,
      existingProfiles,
      profiles,
      validateRegex,
    );
    if (!mapped.ok) {
      return mapped;
    }
    profiles.push(mapped.value.profile);
    warnings.push(...mapped.value.warnings);
  }

  return ok({ profiles, warnings });
}

export function nearestBadgeColor(color: string | undefined): BadgeColor {
  const source = parseHexColor(color);
  if (source === undefined) {
    return "indigo";
  }

  let nearest: BadgeColor = "indigo";
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const name of BADGE_COLORS) {
    const hex = BADGE_PALETTE[name];
    const candidate = parseHexColor(hex);
    if (candidate === undefined) {
      throw new Error("badge palette contains an invalid color");
    }
    const distance = colorDistance(source, candidate);
    if (distance < nearestDistance) {
      nearest = name;
      nearestDistance = distance;
    }
  }
  return nearest;
}

async function mapProfile(
  source: ModHeaderProfile,
  existingProfiles: readonly Profile[],
  plannedProfiles: readonly ImportedProfile[],
  validateRegex: RegexValidator,
): Promise<
  Result<
    {
      readonly profile: ImportedProfile;
      readonly warnings: readonly ModHeaderImportWarning[];
    },
    ImportError
  >
> {
  const name = availableProfileName(
    normalizeProfileName(source.title),
    existingProfiles,
    plannedProfiles,
  );
  const scopeResult = await importScope(source.urlFilters, validateRegex);
  if (!scopeResult.ok) {
    return err({ kind: "invalid-export" });
  }
  const resourceTypes = importResourceTypes(source.resourceFilters);
  if (resourceTypes === undefined) {
    return err({ kind: "invalid-export" });
  }

  const mappings: RuleMapping[] = [];
  for (const row of source.headers ?? []) {
    const parsed = parseSourceRule(row);
    if (parsed === undefined) {
      return err({ kind: "invalid-export" });
    }
    mappings.push(
      mapHeaderRule(parsed, "request", scopeResult.value.scope, resourceTypes),
    );
  }
  for (const row of source.respHeaders ?? []) {
    const parsed = parseSourceRule(row);
    if (parsed === undefined) {
      return err({ kind: "invalid-export" });
    }
    mappings.push(
      mapHeaderRule(parsed, "response", scopeResult.value.scope, resourceTypes),
    );
  }
  for (const row of source.cookieHeaders ?? []) {
    const parsed = parseNamedValue(row);
    if (parsed?.value === undefined) {
      return err({ kind: "invalid-export" });
    }
    mappings.push(
      mapSpecialRule(
        parsed,
        "request",
        "append",
        "cookie",
        `${parsed.name}=${parsed.value}`,
        "cookie-semantics-degraded",
        scopeResult.value.scope,
        resourceTypes,
      ),
    );
  }
  for (const row of source.setCookieHeaders ?? []) {
    const parsed = parseNamedValue(row);
    if (parsed?.value === undefined) {
      return err({ kind: "invalid-export" });
    }
    mappings.push(
      mapSpecialRule(
        parsed,
        "response",
        "set",
        "set-cookie",
        `${parsed.name}=${parsed.value}`,
        "set-cookie-semantics-degraded",
        scopeResult.value.scope,
        resourceTypes,
      ),
    );
  }
  for (const row of source.cspHeaders ?? []) {
    const parsed = parseNamedValue(row);
    if (parsed?.value === undefined) {
      return err({ kind: "invalid-export" });
    }
    mappings.push(
      mapSpecialRule(
        parsed,
        "response",
        "set",
        "content-security-policy",
        `${parsed.name}${parsed.value.length === 0 ? "" : ` ${parsed.value}`}`,
        "csp-semantics-degraded",
        scopeResult.value.scope,
        resourceTypes,
      ),
    );
  }

  const warnings = mappings.flatMap(({ warnings: rowWarnings }) => rowWarnings);
  for (const pattern of scopeResult.value.invalidPatterns) {
    for (const mapping of mappings) {
      warnings.push({
        kind: "invalid-regex",
        ruleName: mapping.ruleName,
        pattern,
      });
    }
  }
  appendDroppedWarnings(source, warnings);

  return ok({
    profile: {
      name,
      badgeText: truncateBadgeText(source.shortTitle ?? source.title),
      color: nearestBadgeColor(source.backgroundColor),
      enabled: false,
      rules: mappings.map(({ rule }) =>
        scopeResult.value.invalidPatterns.length === 0
          ? rule
          : { ...rule, enabled: false },
      ),
    },
    warnings,
  });
}

function mapHeaderRule(
  source: SourceRule,
  direction: "request" | "response",
  scope: Scope,
  resourceTypes: ResourceGroup[] | "all",
): RuleMapping {
  const header = normalizeHeaderName(source.name);
  const requestedOperation = source.operation;
  const operation =
    direction === "request" &&
    requestedOperation === "append" &&
    classifyHeaderName(header).requestAppend === "disallowed"
      ? "set"
      : requestedOperation;
  const ruleName = source.comment?.trim() || header;
  const warnings: ModHeaderImportWarning[] = [];
  if (operation !== requestedOperation) {
    warnings.push({
      kind: "request-append-degraded",
      ruleName,
      header,
    });
  }
  appendDynamicTokenWarning(source.value, ruleName, warnings);

  return {
    rule: {
      direction,
      operation,
      header,
      ...(operation === "remove" ? {} : { value: source.value ?? "" }),
      scope,
      resourceTypes,
      initiators: [],
      enabled: source.enabled,
      ...(source.comment === undefined ? {} : { comment: source.comment }),
    },
    ruleName,
    warnings,
  };
}

function mapSpecialRule(
  source: Omit<SourceRule, "operation">,
  direction: "request" | "response",
  operation: HeaderOp,
  header: string,
  value: string,
  warningKind:
    | "cookie-semantics-degraded"
    | "set-cookie-semantics-degraded"
    | "csp-semantics-degraded",
  scope: Scope,
  resourceTypes: ResourceGroup[] | "all",
): RuleMapping {
  const ruleName = source.comment?.trim() || source.name;
  const warnings: ModHeaderImportWarning[] = [{ kind: warningKind, ruleName }];
  appendDynamicTokenWarning(value, ruleName, warnings);

  return {
    rule: {
      direction,
      operation,
      header,
      value,
      scope,
      resourceTypes,
      initiators: [],
      enabled: source.enabled,
      ...(source.comment === undefined ? {} : { comment: source.comment }),
    },
    ruleName,
    warnings,
  };
}

async function importScope(
  rows: readonly Record<string, unknown>[] | undefined,
  validateRegex: RegexValidator,
): Promise<
  Result<
    { readonly scope: Scope; readonly invalidPatterns: readonly string[] },
    ImportError
  >
> {
  const patterns: string[] = [];
  for (const row of rows ?? []) {
    const { enabled, urlRegex } = row;
    if (typeof enabled !== "boolean" || typeof urlRegex !== "string") {
      return err({ kind: "invalid-export" });
    }
    if (enabled) {
      patterns.push(urlRegex);
    }
  }
  if (patterns.length === 0) {
    return ok({ scope: { type: "all" }, invalidPatterns: [] });
  }

  const uniquePatterns = [...new Set(patterns)];
  const invalidPatterns: string[] = [];
  for (const pattern of uniquePatterns) {
    if (!(await validateRegex(pattern)).ok) {
      invalidPatterns.push(pattern);
    }
  }
  const regex =
    uniquePatterns.length === 1
      ? (uniquePatterns[0] ?? "")
      : uniquePatterns.map((pattern) => `(?:${pattern})`).join("|");
  if (
    uniquePatterns.length > 1 &&
    invalidPatterns.length === 0 &&
    !(await validateRegex(regex)).ok
  ) {
    invalidPatterns.push(regex);
  }

  return ok({
    scope: { type: "regex", regex, hosts: [] },
    invalidPatterns,
  });
}

function importResourceTypes(
  rows: readonly Record<string, unknown>[] | undefined,
): ResourceGroup[] | "all" | undefined {
  const groups: ResourceGroup[] = [];
  for (const row of rows ?? []) {
    const { enabled, resourceType } = row;
    if (
      typeof enabled !== "boolean" ||
      !Array.isArray(resourceType) ||
      !resourceType.every((item) => typeof item === "string")
    ) {
      return undefined;
    }
    if (!enabled) {
      continue;
    }
    for (const item of resourceType) {
      const group = importResourceType(item);
      if (!groups.includes(group)) {
        groups.push(group);
      }
    }
  }
  return groups.length === 0 ? "all" : groups;
}

function importResourceType(resourceType: string): ResourceGroup {
  switch (resourceType) {
    case "main_frame":
      return "pages";
    case "sub_frame":
      return "subframes";
    case "xmlhttprequest":
      return "xhr";
    case "script":
      return "scripts";
    case "stylesheet":
      return "stylesheets";
    case "image":
      return "images";
    case "font":
      return "fonts";
    case "media":
      return "media";
    case "websocket":
      return "websockets";
    default:
      return "other";
  }
}

function appendDroppedWarnings(
  profile: ModHeaderProfile,
  warnings: ModHeaderImportWarning[],
): void {
  for (const [field, kind] of DROPPED_FILTER_FIELDS) {
    const rows = profile[field] ?? [];
    rows.forEach((row, index) => {
      warnings.push({
        kind,
        ruleName: `${profile.title}: ${field} ${index + 1}`,
        value: describeRow(row),
      });
    });
  }
}

function appendDynamicTokenWarning(
  value: string | undefined,
  ruleName: string,
  warnings: ModHeaderImportWarning[],
): void {
  if (value === undefined) {
    return;
  }
  const tokens = Array.from(
    value.matchAll(/\{\{([^{}]+)\}\}/g),
    (match) => match[1] ?? "",
  ).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return;
  }
  const convertible = tokens.filter(
    (token): token is "uuid" | "timestamp" =>
      token === "uuid" || token === "timestamp",
  );
  warnings.push({
    kind: "dynamic-token",
    ruleName,
    tokens,
    ...(convertible.length === 0
      ? {}
      : {
          conversionOffer: {
            kind: "convert-to-frozen-value",
            tokens: convertible,
          },
        }),
  });
}

function parseSourceRule(row: Record<string, unknown>): SourceRule | undefined {
  const parsed = parseNamedValue(row, true);
  if (parsed === undefined) {
    return undefined;
  }
  const operation = sourceOperation(row, parsed.value);
  return operation === undefined ? undefined : { ...parsed, operation };
}

function parseNamedValue(
  row: Record<string, unknown>,
  allowMissingValue = false,
): Omit<SourceRule, "operation"> | undefined {
  const { enabled, name, value, comment } = row;
  if (
    typeof enabled !== "boolean" ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    (!allowMissingValue && typeof value !== "string") ||
    (value !== undefined && typeof value !== "string") ||
    (comment !== undefined && typeof comment !== "string")
  ) {
    return undefined;
  }
  return {
    enabled,
    name,
    ...(value === undefined ? {} : { value }),
    ...(comment === undefined ? {} : { comment }),
  };
}

function sourceOperation(
  row: Record<string, unknown>,
  value: string | undefined,
): HeaderOp | undefined {
  const { action, append, appendMode, operation } = row;
  const declared = operation ?? action;
  if (declared !== undefined) {
    return declared === "set" || declared === "append" || declared === "remove"
      ? declared
      : undefined;
  }
  if (
    append === true ||
    appendMode === true ||
    appendMode === "append" ||
    appendMode === "comma"
  ) {
    return "append";
  }
  return value === undefined ? "remove" : "set";
}

function isModHeaderExport(value: unknown): value is ModHeaderProfile[] {
  return Array.isArray(value) && value.length > 0 && value.every(isProfile);
}

function isProfile(value: unknown): value is ModHeaderProfile {
  if (!isRecord(value)) {
    return false;
  }
  const { title, shortTitle, backgroundColor } = value;
  return (
    typeof title === "string" &&
    title.trim().length > 0 &&
    (shortTitle === undefined || typeof shortTitle === "string") &&
    (backgroundColor === undefined || typeof backgroundColor === "string") &&
    PROFILE_ARRAY_FIELDS.every((field) => isOptionalRecordArray(value[field]))
  );
}

function isOptionalRecordArray(
  value: unknown,
): value is readonly Record<string, unknown>[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isRecord));
}

function normalizeProfileName(title: string): string {
  return title.trim().slice(0, 48).trimEnd();
}

function truncateBadgeText(text: string): string {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    ({ segment }) => segment,
  )
    .slice(0, 2)
    .join("");
}

function describeRow(row: Record<string, unknown>): string {
  for (const field of [
    "urlRegex",
    "domain",
    "name",
    "value",
    "tabId",
    "tabGroupId",
    "windowId",
  ]) {
    const value = row[field];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return JSON.stringify(row);
}

function parseHexColor(
  color: string | undefined,
): readonly [number, number, number] | undefined {
  if (color === undefined) {
    return undefined;
  }
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  const hex = match?.[1];
  if (hex === undefined) {
    return undefined;
  }
  const expanded =
    hex.length === 3
      ? Array.from(hex, (character) => `${character}${character}`).join("")
      : hex;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function colorDistance(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left.reduce(
    (distance, channel, index) =>
      distance + (channel - (right[index] ?? 0)) ** 2,
    0,
  );
}
