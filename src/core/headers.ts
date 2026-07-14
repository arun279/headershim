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

export type HeaderErrorClass =
  | "name-required"
  | "name-invalid"
  | "name-not-modifiable"
  | "value-required"
  | "value-line-break"
  | "request-append-not-allowed";

export const HEADER_ERROR_COPY_IDS = {
  "name-required": "header-name-required",
  "name-invalid": "header-name-invalid",
  "name-not-modifiable": "header-not-modifiable",
  "value-required": "header-value-required",
  "value-line-break": "header-value-line-break",
  "request-append-not-allowed": "request-append-not-allowed",
} as const satisfies Record<HeaderErrorClass, string>;

export type HeaderAdvisoryClass = "network-managed" | "host-http2";

export const HEADER_ADVISORY_COPY_IDS = {
  "network-managed": "header-network-managed",
  "host-http2": "header-host-http2",
} as const satisfies Record<HeaderAdvisoryClass, string>;

export type HeaderValidationError =
  | {
      readonly kind: "name-required";
      readonly copyId: (typeof HEADER_ERROR_COPY_IDS)["name-required"];
    }
  | {
      readonly kind: "name-invalid";
      readonly copyId: (typeof HEADER_ERROR_COPY_IDS)["name-invalid"];
    }
  | {
      readonly kind: "name-not-modifiable";
      readonly copyId: (typeof HEADER_ERROR_COPY_IDS)["name-not-modifiable"];
    }
  | {
      readonly kind: "value-required";
      readonly copyId: (typeof HEADER_ERROR_COPY_IDS)["value-required"];
    }
  | {
      readonly kind: "value-line-break";
      readonly copyId: (typeof HEADER_ERROR_COPY_IDS)["value-line-break"];
    }
  | {
      readonly kind: "request-append-not-allowed";
      readonly copyId: (typeof HEADER_ERROR_COPY_IDS)["request-append-not-allowed"];
      readonly header: string;
    };

type HeaderAdvisory =
  | {
      readonly kind: "network-managed";
      readonly copyId: (typeof HEADER_ADVISORY_COPY_IDS)["network-managed"];
    }
  | {
      readonly kind: "host-http2";
      readonly copyId: (typeof HEADER_ADVISORY_COPY_IDS)["host-http2"];
    };

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
const NETWORK_MANAGED_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function normalizeHeaderName(header: string): string {
  return header.trim().toLowerCase();
}

export function classifyHeaderName(header: string): HeaderClassification {
  const normalized = normalizeHeaderName(header);

  return {
    requestAppend: REQUEST_APPEND_HEADER_SET.has(normalized)
      ? "allowed"
      : "disallowed",
    advisories: NETWORK_MANAGED_HEADERS.has(normalized)
      ? [
          {
            kind: "network-managed",
            copyId: HEADER_ADVISORY_COPY_IDS["network-managed"],
          },
        ]
      : normalized === "host"
        ? [
            {
              kind: "host-http2",
              copyId: HEADER_ADVISORY_COPY_IDS["host-http2"],
            },
          ]
        : [],
  };
}

// The two sensitive-header classes, alongside classifyHeaderName's capability
// advisories (network-managed, host). Unlike those — which say "this rule may do
// nothing" — these say "this rule has a real, security-relevant effect": it
// disarms a protection the site sent, or attaches a secret to outgoing requests.
// The recognition is name-based; whether the effect actually applies is gated on
// direction and operation by headerSensitivity below.
export type SensitiveHeaderClass = "security-response" | "credential-request";

// Response headers a site sends to protect itself. Removing or overriding any of
// these weakens the user's own security: clickjacking (XFO / CSP frame-ancestors),
// MIME-sniffing (XCTO), transport downgrade (HSTS), cross-origin read/embed
// (COOP/COEP/CORP and the Access-Control-* CORS set), referrer/permissions
// leakage, and cookie flags (Set-Cookie). Sourced from the WHATWG Fetch and W3C
// webappsec specs plus the audit.
const SECURITY_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "x-permitted-cross-domain-policies",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "set-cookie",
]);

// Request headers whose value is a credential. authorization / proxy-authorization
// / cookie are the standards-named three; the pattern catches the common
// API-key / token shapes (x-api-key, x-auth-token, *-secret, …). Warn-not-block,
// so a rare benign match only adds an informational caution.
const CREDENTIAL_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
]);
const CREDENTIAL_HEADER_PATTERN =
  /(?:^|[-_])(?:api[-_]?key|api[-_]?token|auth[-_]?token|access[-_]?token|session[-_]?token|csrf[-_]?token|xsrf[-_]?token|client[-_]?secret|apikey|secret)$/;

// Set-Cookie flags that keep a cookie protected; a value carrying none of them
// replaces the server's cookie with a weaker one.
const COOKIE_PROTECTION_ATTRIBUTES: ReadonlySet<string> = new Set([
  "secure",
  "httponly",
  "samesite",
]);

function isCredentialHeaderName(header: string): boolean {
  return (
    CREDENTIAL_REQUEST_HEADERS.has(header) ||
    CREDENTIAL_HEADER_PATTERN.test(header)
  );
}

export interface SensitiveHeaderInput {
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
}

/**
 * The sensitive-header advisory that applies to a rule in this direction and
 * operation, if any — the shared primitive behind the editor advisory, the
 * import review, the all-sites caution, and the credential-rule initiator
 * default in compile. Direction-gated on purpose: a protection header only
 * weakens when a *response* rule removes or overrides it (append can only tighten
 * a policy), and a credential only leaks when a *request* rule attaches a value
 * (remove sends nothing).
 */
export function headerSensitivity(
  input: SensitiveHeaderInput,
): SensitiveHeaderClass | undefined {
  const header = normalizeHeaderName(input.header);
  if (
    input.direction === "response" &&
    input.operation !== "append" &&
    SECURITY_RESPONSE_HEADERS.has(header)
  ) {
    return "security-response";
  }
  if (
    input.direction === "request" &&
    input.operation !== "remove" &&
    isCredentialHeaderName(header)
  ) {
    return "credential-request";
  }
  return undefined;
}

/** A Set-Cookie value carrying none of Secure / HttpOnly / SameSite. */
export function setCookieAttributesStripped(
  value: string | undefined,
): boolean {
  if (value === undefined) {
    return false;
  }
  // Parse the attributes rather than substring-match the whole value: split on
  // ";", drop the leading name=value pair, and read each remaining segment's
  // attribute name (the part before any "="). A substring check would be fooled
  // by a cookie name or value that merely contains "secure"/"httponly"/
  // "samesite" (e.g. `secure_session=abc`).
  const hasProtection = value
    .split(";")
    .slice(1)
    .some((segment) => {
      const name = segment.split("=", 1)[0]?.trim().toLowerCase();
      return name !== undefined && COOKIE_PROTECTION_ATTRIBUTES.has(name);
    });
  return !hasProtection;
}

export function validateHeader(
  input: HeaderInput,
): Result<ValidatedHeader, HeaderValidationError> {
  const header = normalizeHeaderName(input.header);
  if (header.length === 0) {
    return err({
      kind: "name-required",
      copyId: HEADER_ERROR_COPY_IDS["name-required"],
    });
  }
  if (header.startsWith(":")) {
    return err({
      kind: "name-not-modifiable",
      copyId: HEADER_ERROR_COPY_IDS["name-not-modifiable"],
    });
  }
  if (!HTTP_TOKEN.test(header)) {
    return err({
      kind: "name-invalid",
      copyId: HEADER_ERROR_COPY_IDS["name-invalid"],
    });
  }
  if (input.operation !== "remove" && input.value === undefined) {
    return err({
      kind: "value-required",
      copyId: HEADER_ERROR_COPY_IDS["value-required"],
    });
  }
  if (
    input.operation !== "remove" &&
    input.value !== undefined &&
    /[\r\n]/.test(input.value)
  ) {
    return err({
      kind: "value-line-break",
      copyId: HEADER_ERROR_COPY_IDS["value-line-break"],
    });
  }

  const classification = classifyHeaderName(header);
  if (
    input.direction === "request" &&
    input.operation === "append" &&
    classification.requestAppend === "disallowed"
  ) {
    return err({
      kind: "request-append-not-allowed",
      copyId: HEADER_ERROR_COPY_IDS["request-append-not-allowed"],
      header,
    });
  }

  return ok({
    header,
    ...(input.operation === "remove" ? {} : { value: input.value }),
    classification,
  });
}
