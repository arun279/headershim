import type { Rule, StateDoc } from "./model";
import { err, ok, type Result } from "./result";

export const MAX_ENABLED_RULES = 4_500;
export const MAX_REGEX_RULES = 1_000;
export const MAX_SESSION_OVERRIDES = 1_000;
export const MAX_DOC_BYTES = 4 * 1024 * 1024;
export const RULE_COUNT_WARNING_THRESHOLD = 4_000;

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
