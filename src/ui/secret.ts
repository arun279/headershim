/**
 * Secret-value redaction, shared by every surface that shows a header value. A
 * secret value is never printed in the clear: list summaries show a scheme word
 * plus a redaction marker, and the popup masks it to a tail. Which headers count
 * is core's `isSecretHeader`, the same list the editor advisory and the import
 * review read, so no surface can disagree about what a secret is.
 */

import { isSecretHeader } from "../core/headers";
import { copy } from "./copy";

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
  const scheme = /^(basic|bearer|digest|negotiate)\s+/i.exec(value)?.[1];
  return scheme === undefined
    ? copy.rules.redacted
    : `${scheme} ${copy.rules.redacted}`;
}
