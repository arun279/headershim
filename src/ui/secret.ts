/**
 * Secret-value redaction, shared by every surface that shows a header value. A
 * secret value is never printed in the clear: list summaries show a scheme word
 * plus a redaction marker, and the popup masks it to a tail. Which headers count
 * is core's `isSecretHeader`, the same list the editor advisory and the import
 * review read, so no surface can disagree about what a secret is.
 */

import { isSecretHeader } from "../core/headers";
import type { Rule } from "../core/model";
import { copy } from "./copy";
import { SCHEME } from "./token";

export { isSecretHeader };

export function headerValueSummary(
  header: string,
  value: string | undefined,
): string | undefined {
  // An empty value has nothing to withhold, and a redaction marker there would
  // draw a secret that does not exist.
  if (value === undefined || value === "" || !isSecretHeader(header)) {
    return value;
  }
  const scheme = SCHEME.exec(value)?.[1];
  return scheme === undefined
    ? copy.rules.redacted
    : `${scheme} ${copy.rules.redacted}`;
}

export function ruleValueSummary(
  rule: Pick<Rule, "generated" | "header" | "value">,
): string | undefined {
  if (
    (rule.value === undefined || rule.value === "") &&
    rule.generated !== undefined
  ) {
    return copy.rules.generated(copy.editor.generatedKind[rule.generated.kind]);
  }
  return headerValueSummary(rule.header, rule.value);
}
