import type { Direction, HeaderOp } from "./model";
import { err, ok, type Result } from "./result";

export const REQUEST_APPEND_HEADERS = [
  "accept",
  "accept-encoding",
  "accept-language",
  "access-control-request-headers",
  "cache-control",
  "connection",
  "content-language",
  "cookie",
  "forwarded",
  "if-match",
  "if-none-match",
  "keep-alive",
  "range",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
  "want-digest",
  "x-forwarded-for",
] as const;

export type HeaderAdvisoryClass =
  | "h1-only"
  | "h2-breaking"
  | "host-http2"
  | "credential"
  | "security-response";

export type HeaderValidationError =
  | { readonly kind: "name-required" }
  | { readonly kind: "name-invalid" }
  | { readonly kind: "name-not-modifiable" }
  | { readonly kind: "value-required" }
  | { readonly kind: "value-invalid" }
  | {
      readonly kind: "request-append-not-allowed";
      readonly header: string;
    };

type HeaderAdvisory =
  | { readonly kind: "h1-only" }
  | { readonly kind: "h2-breaking" }
  | { readonly kind: "host-http2" }
  | { readonly kind: "credential" }
  | { readonly kind: "security-response" };

type SensitivityAdvisory = Extract<
  HeaderAdvisory,
  { kind: "credential" | "security-response" }
>;

export interface HeaderClassification {
  readonly requestAppend: "allowed" | "disallowed";
  readonly advisories: readonly HeaderAdvisory[];
}

export interface HeaderInput {
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  readonly value?: string;
}

export interface ValidatedHeader {
  readonly header: string;
  readonly value?: string;
  readonly classification: HeaderClassification;
}

export const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const REQUEST_APPEND_HEADER_SET: ReadonlySet<string> = new Set(
  REQUEST_APPEND_HEADERS,
);
// Both transport sets state measured request-side behavior (set rules driven
// through HTTP/1.1 and HTTP/2 echo servers); the response side is unmeasured,
// so classifyHeaderName stays silent there. HTTP/1.1 carried every member as
// written. On HTTP/2 the h1-only members were absent from the request, and the
// h2-breaking members made the request itself fail, except te with the value
// "trailers" and a content-length that agrees with the body, which both
// arrived. RFC 9113 section 8.2.2 corroborates the split.
const H1_ONLY_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "transfer-encoding",
]);
const H2_BREAKING_HEADERS: ReadonlySet<string> = new Set([
  "content-length",
  "keep-alive",
  "te",
  "upgrade",
]);
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "x-api-key",
]);
// Response headers whose value can change the browser's security policy for a
// page.
const SECURITY_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "access-control-allow-credentials",
  "access-control-allow-origin",
  "content-security-policy",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
]);

export function normalizeHeaderName(header: string): string {
  return header.trim().toLowerCase();
}

/**
 * Whether a header carries a credential. The one list behind every surface that
 * treats a value as a secret: the editor's advisory, the import review, and the
 * redaction the popup and the rule lists apply.
 */
export function isSecretHeader(header: string): boolean {
  const normalized = normalizeHeaderName(header);
  return (
    CREDENTIAL_HEADERS.has(normalized) ||
    (normalized.startsWith("x-") && normalized.endsWith("-token"))
  );
}

/**
 * Whether a header is one a site sends on its own responses. The single source
 * behind both directions of the response-header advisory: the protection this
 * takes away when it is changed on the response side, and the nothing it does
 * on the request side.
 */
export function isSecurityResponseHeader(header: string): boolean {
  return SECURITY_RESPONSE_HEADERS.has(normalizeHeaderName(header));
}

/**
 * Whether Chrome will append to this request header, given an already
 * normalized name. Exposed on its own because the compiler and the ModHeader
 * codec want this answer and nothing else: reaching it through
 * classifyHeaderName pulls the advisory tables into the background bundle,
 * which never reads one.
 */
export function allowsRequestAppend(normalizedHeader: string): boolean {
  return REQUEST_APPEND_HEADER_SET.has(normalizedHeader);
}

export function classifyHeaderName(
  header: string,
  direction: Direction,
): HeaderClassification {
  const normalized = normalizeHeaderName(header);

  return {
    requestAppend: allowsRequestAppend(normalized) ? "allowed" : "disallowed",
    // The transport advisories are request-side measurements, so only request
    // rules carry one; a response rule on the same name says nothing rather
    // than repeating a claim nothing has measured.
    advisories:
      direction !== "request"
        ? []
        : H1_ONLY_HEADERS.has(normalized)
          ? [{ kind: "h1-only" }]
          : H2_BREAKING_HEADERS.has(normalized)
            ? [{ kind: "h2-breaking" }]
            : normalized === "host"
              ? [{ kind: "host-http2" }]
              : [],
  };
}

/**
 * Flags changes that carry credentials or alter a response security policy.
 * Warn, never block: calling an API and changing a page policy are both
 * legitimate.
 */
export function headerSensitivity(
  input: HeaderInput,
): readonly SensitivityAdvisory[] {
  const header = normalizeHeaderName(input.header);
  const advisories: SensitivityAdvisory[] = [];

  if (input.operation !== "remove" && isSecretHeader(header)) {
    advisories.push({ kind: "credential" });
  }
  if (input.direction === "response" && isSecurityResponseHeader(header)) {
    advisories.push({ kind: "security-response" });
  }

  return advisories;
}

/**
 * What is wrong with a header name, or nothing. The one authority the commit
 * gate and the name field both read, so what the field flags as you type and
 * what the save refuses can never be two different verdicts on the same name.
 * Expects an already normalized name.
 */
export function validateHeaderName(
  header: string,
): HeaderValidationError | undefined {
  if (header.length === 0) {
    return { kind: "name-required" };
  }
  if (header.startsWith(":")) {
    return { kind: "name-not-modifiable" };
  }
  if (!HTTP_TOKEN.test(header)) {
    return { kind: "name-invalid" };
  }
  return undefined;
}

export function isValidHeaderValue(value: string): boolean {
  return !/[\0\r\n]/u.test(value);
}

export function validateHeader(
  input: HeaderInput,
): Result<ValidatedHeader, HeaderValidationError> {
  const header = normalizeHeaderName(input.header);
  const nameError = validateHeaderName(header);
  if (nameError !== undefined) {
    return err(nameError);
  }
  if (input.operation !== "remove" && input.value === undefined) {
    return err({ kind: "value-required" });
  }
  if (
    input.operation !== "remove" &&
    input.value !== undefined &&
    !isValidHeaderValue(input.value)
  ) {
    return err({ kind: "value-invalid" });
  }

  const classification = classifyHeaderName(header, input.direction);
  if (
    input.direction === "request" &&
    input.operation === "append" &&
    classification.requestAppend === "disallowed"
  ) {
    return err({ kind: "request-append-not-allowed", header });
  }

  return ok({
    header,
    ...(input.operation === "remove" ? {} : { value: input.value }),
    classification,
  });
}
