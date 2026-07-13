import type { ComponentChildren } from "preact";
import type { Rule } from "../../core/model";
import { copy } from "../copy";
import { MiddleTruncate } from "./MiddleTruncate";
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
}: {
  rule: Rule;
  secondLine: ComponentChildren;
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
          <span class="rule-name">{rule.header}</span>
          {rule.operation !== "remove" && rule.value !== undefined && (
            <>
              <span class="colon">: </span>
              <MiddleTruncate value={rule.value} class="rule-value" />
            </>
          )}
        </p>
        <p class="rule-line2">{secondLine}</p>
      </div>
    </>
  );
}
