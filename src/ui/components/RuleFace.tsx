import type { ComponentChildren } from "preact";
import type { Rule } from "../../core/model";
import { copy } from "../copy";
import { Truncate } from "./Truncate";
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
}: {
  rule: Rule;
  secondLine: ComponentChildren;
  secondLineTitle?: string | undefined;
}) {
  const value = ruleValueSummary(rule);
  return (
    <>
      <span class="rule-dir">
        <span role="img" aria-label={copy.rules.direction[rule.direction]}>
          {rule.direction === "request" ? "→" : "←"}
        </span>
        <span class="rule-op">{copy.rules.operation[rule.operation]}</span>
      </span>
      <div class="rule-lines">
        <p class="rule-line1">
          <Truncate value={rule.header} class="rule-name" />
          {rule.operation !== "remove" && value !== undefined && (
            <span class="rule-value-preview">
              <span class="colon">: </span>
              <Truncate mode="middle" value={value} class="rule-value" />
            </span>
          )}
        </p>
        <p class="rule-line2" title={secondLineTitle}>
          {secondLine}
        </p>
      </div>
    </>
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
  if (
    rule.value === undefined ||
    !SECRET_HEADERS.has(rule.header.toLowerCase())
  ) {
    return rule.value;
  }
  const scheme = /^(basic|bearer|digest|negotiate)\s+/i.exec(rule.value)?.[1];
  return scheme === undefined
    ? copy.rules.redacted
    : `${scheme} ${copy.rules.redacted}`;
}
