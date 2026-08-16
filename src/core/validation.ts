import {
  RESOURCE_GROUPS,
  type ResourceGroup,
  type Rule,
  type Scope,
} from "./model";

export { BADGE_COLORS, DIRECTIONS, HEADER_OPERATIONS } from "./model";

export function hasValidHeaderValue(rule: Record<string, unknown>): boolean {
  const { operation, value } = rule;
  return operation === "remove"
    ? value === undefined
    : typeof value === "string";
}

export function isScope(value: unknown): value is Scope {
  if (!isRecord(value)) {
    return false;
  }

  const { type, domains, pattern, regex, hosts } = value;
  switch (type) {
    case "domains":
      return isStringArray(domains) && domains.length > 0;
    case "pattern":
      return (
        typeof pattern === "string" &&
        pattern.length > 0 &&
        isStringArray(hosts)
      );
    case "regex":
      return (
        typeof regex === "string" && regex.length > 0 && isStringArray(hosts)
      );
    case "all":
      return true;
    default:
      return false;
  }
}

export function isResourceTypes(
  value: unknown,
): value is ResourceGroup[] | "all" {
  return (
    value === "all" ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => isOneOf(item, RESOURCE_GROUPS)) &&
      new Set(value).size === value.length)
  );
}

export function isGeneratedValue(
  value: unknown,
): value is NonNullable<Rule["generated"]> {
  if (!isRecord(value)) {
    return false;
  }

  const { kind, at } = value;
  return (kind === "uuid" || kind === "timestamp") && typeof at === "string";
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

export function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return (
    typeof value === "string" && options.some((option) => option === value)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
