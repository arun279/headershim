import type { ComponentChildren } from "preact";
import type { Rule } from "../../core/model";
import { copy } from "../copy";
import { PencilGlyph } from "./glyphs";
import { TRUNCATION_LIMITS, Truncate } from "./Truncate";
import "./RuleFace.css";

/**
 * The shared visual core of a rule: the direction/operation glyph and the two
 * text lines (header:value, then a caller-supplied status/scope line). The popup
 * rule row and the options bulk panel render the same face so the grammar reads
 * identically in both places.
 */
export function RuleFace({
  rule,
  secondLine,
  secondLineTitle,
  onEditValue,
}: {
  rule: Rule;
  secondLine: ComponentChildren;
  secondLineTitle?: string | undefined;
  onEditValue?: (() => void) | undefined;
}) {
  const value = ruleValueSummary(rule);
  return (
    <div class="rule-lines">
      <p
        class={
          rule.operation !== "remove" && value !== undefined
            ? "rule-line1 has-value"
            : "rule-line1"
        }
      >
        <Truncate
          mode="middle"
          value={rule.header}
          maxChars={TRUNCATION_LIMITS.header}
          class="rule-name"
        />
        {rule.operation !== "remove" && value !== undefined && (
          <span class="rule-value-preview">
            <span class="colon">: </span>
            {onEditValue === undefined ? (
              <Truncate
                mode="middle"
                value={value}
                maxChars={TRUNCATION_LIMITS.value}
                class="rule-value"
              />
            ) : (
              <button
                type="button"
                class="rule-value-button"
                aria-label={copy.menu.editValue}
                onClick={(event) => {
                  event.stopPropagation();
                  onEditValue();
                }}
              >
                <Truncate
                  mode="middle"
                  value={value}
                  maxChars={TRUNCATION_LIMITS.value}
                  class="rule-value"
                />
                <span class="rule-value-pencil">
                  <PencilGlyph />
                </span>
              </button>
            )}
          </span>
        )}
      </p>
      <p class="rule-line2" title={secondLineTitle}>
        {rule.operation !== "set" && (
          <>
            <span class="rule-op">
              {copy.rules.operation[rule.operation]}
            </span>{" "}
          </>
        )}
        <span
          class="rule-direction"
          role="img"
          aria-label={copy.rules.direction[rule.direction]}
        >
          {rule.direction === "request" ? "→" : "←"}
        </span>{" "}
        {secondLine}
      </p>
    </div>
  );
}

const SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "x-api-key",
]);

/** Rule-list summaries never expose credential-bearing header values. */
export function ruleValueSummary(rule: Rule): string | undefined {
  return headerValueSummary(rule.header, rule.value);
}

export function headerValueSummary(
  header: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined || !isSecretHeader(header)) return value;
  const scheme = /^(basic|bearer|digest|negotiate)\s+/i.exec(value)?.[1];
  return scheme === undefined
    ? copy.rules.redacted
    : `${scheme} ${copy.rules.redacted}`;
}

export function isSecretHeader(header: string): boolean {
  const normalized = header.toLowerCase();
  return (
    SECRET_HEADERS.has(normalized) ||
    (normalized.startsWith("x-") && normalized.endsWith("-token"))
  );
}
