import type { Rule, StateDoc } from "./model";
import { err, ok, type Result } from "./result";

export const MAX_DYNAMIC_RULES = 5_000;
export const MAX_ENABLED_RULES = 4_500;
export const MAX_REGEX_RULES = 1_000;
export const MAX_SESSION_OVERRIDES = 1_000;
export const MINIMUM_CHROME_VERSION = 120;
export const MAX_DOC_BYTES = 4 * 1024 * 1024;
export const RULE_COUNT_WARNING_THRESHOLD = MAX_ENABLED_RULES - 500;

export type LimitError =
  | {
      readonly kind: "enabled-rule-limit-exceeded";
      readonly count: number;
      readonly limit: typeof MAX_ENABLED_RULES;
    }
  | {
      readonly kind: "regex-rule-limit-exceeded";
      readonly count: number;
      readonly limit: typeof MAX_REGEX_RULES;
    }
  | {
      readonly kind: "dynamic-rule-limit-exceeded";
      readonly count: number;
      readonly limit: typeof MAX_DYNAMIC_RULES;
    }
  | {
      readonly kind: "session-override-limit-exceeded";
      readonly count: number;
      readonly limit: typeof MAX_SESSION_OVERRIDES;
    }
  | {
      readonly kind: "doc-byte-limit-exceeded";
      readonly bytes: number;
      readonly limit: typeof MAX_DOC_BYTES;
    };

export function checkEnabledRuleLimits(
  candidateEnabledRules: readonly Rule[],
): Result<void, LimitError> {
  if (candidateEnabledRules.length > MAX_ENABLED_RULES) {
    return err({
      kind: "enabled-rule-limit-exceeded",
      count: candidateEnabledRules.length,
      limit: MAX_ENABLED_RULES,
    });
  }

  const dynamicCount = projectedDynamicRuleCount(candidateEnabledRules);
  if (dynamicCount > MAX_DYNAMIC_RULES) {
    return err({
      kind: "dynamic-rule-limit-exceeded",
      count: dynamicCount,
      limit: MAX_DYNAMIC_RULES,
    });
  }

  const regexCount = candidateEnabledRules.filter(
    (rule) => rule.scope.type === "regex",
  ).length;
  if (regexCount > MAX_REGEX_RULES) {
    return err({
      kind: "regex-rule-limit-exceeded",
      count: regexCount,
      limit: MAX_REGEX_RULES,
    });
  }

  return ok(undefined);
}

export function enabledRulesFit(
  candidateEnabledRules: readonly Rule[],
): boolean {
  return (
    candidateEnabledRules.length <= MAX_ENABLED_RULES &&
    projectedDynamicRuleCount(candidateEnabledRules) <= MAX_DYNAMIC_RULES &&
    candidateEnabledRules.filter((rule) => rule.scope.type === "regex")
      .length <= MAX_REGEX_RULES
  );
}

/**
 * A domains rule can produce one installed projection per named domain: either
 * that domain joins the fully granted projection or it needs its own narrowed
 * filter. Other scopes never split. Counting that grant-independent ceiling at
 * commit time prevents a saved profile from overflowing Chrome after grants
 * change.
 */
export function projectedDynamicRuleCount(
  candidateEnabledRules: readonly Rule[],
): number {
  return candidateEnabledRules.reduce(
    (count, rule) =>
      count +
      (rule.scope.type === "domains"
        ? Math.max(1, rule.scope.domains.length)
        : 1),
    0,
  );
}

export function checkSessionOverrideLimit(
  candidateCount: number,
): Result<
  void,
  Extract<LimitError, { kind: "session-override-limit-exceeded" }>
> {
  return candidateCount <= MAX_SESSION_OVERRIDES
    ? ok(undefined)
    : err({
        kind: "session-override-limit-exceeded",
        count: candidateCount,
        limit: MAX_SESSION_OVERRIDES,
      });
}

export function serializedStateDocBytes(doc: StateDoc): number {
  return new TextEncoder().encode(JSON.stringify(doc)).byteLength;
}

export function checkStateDocByteLimit(
  doc: StateDoc,
): Result<void, LimitError> {
  const bytes = serializedStateDocBytes(doc);
  return bytes <= MAX_DOC_BYTES
    ? ok(undefined)
    : err({ kind: "doc-byte-limit-exceeded", bytes, limit: MAX_DOC_BYTES });
}

export function shouldShowRuleCountWarning(enabledRuleCount: number): boolean {
  return enabledRuleCount > RULE_COUNT_WARNING_THRESHOLD;
}
