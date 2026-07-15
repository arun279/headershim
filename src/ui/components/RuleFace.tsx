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
          {rule.operation !== "remove" && rule.value !== undefined && (
            <>
              <span class="colon">: </span>
              <Truncate mode="middle" value={rule.value} class="rule-value" />
            </>
          )}
        </p>
        <p class="rule-line2" title={secondLineTitle}>
          {secondLine}
        </p>
      </div>
    </>
  );
}
