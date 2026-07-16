/**
 * Credential-header detection and redaction, shared by every surface that shows
 * a header value. A secret value is never printed in the clear: list summaries
 * show a scheme word plus a redaction marker, and the popup masks it to a tail.
 */

import type { Rule } from "../core/model";
import { copy } from "./copy";

const SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "x-api-key",
]);

export function isSecretHeader(header: string): boolean {
  const normalized = header.toLowerCase();
  return (
    SECRET_HEADERS.has(normalized) ||
    (normalized.startsWith("x-") && normalized.endsWith("-token"))
  );
}

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
