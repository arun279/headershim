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

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
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
