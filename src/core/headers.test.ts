import { describe, expect, it } from "vitest";
import {
  classifyHeaderName,
  HEADER_ADVISORY_COPY_IDS,
  HEADER_ERROR_COPY_IDS,
  headerSensitivity,
  isSecretHeader,
  normalizeHeaderName,
  REQUEST_APPEND_HEADERS,
  validateHeader,
} from "./headers";
import type { Direction, HeaderOp } from "./model";

function input(
  overrides: Partial<{
    direction: Direction;
    operation: HeaderOp;
    header: string;
    value: string;
  }> = {},
) {
  return {
    direction: "request" as const,
    operation: "set" as const,
    header: "x-debug",
    value: "on",
    ...overrides,
  };
}

describe("header name validation", () => {
  it("trims and lowercases legal HTTP token names", () => {
    expect(normalizeHeaderName("  X-Feature_Override  ")).toBe(
      "x-feature_override",
    );
    expect(validateHeader(input({ header: "  X-Feature_Override  " }))).toEqual(
      {
        ok: true,
        value: {
          header: "x-feature_override",
          value: "on",
          classification: { requestAppend: "disallowed", advisories: [] },
        },
      },
    );
    expect(validateHeader(input({ header: "!#$%&'*+-.^_`|~09AZaz" })).ok).toBe(
      true,
    );
  });

  it("rejects missing and non-token names", () => {
    expect(validateHeader(input({ header: "  " }))).toEqual({
      ok: false,
      error: {
        kind: "name-required",
        copyId: "header-name-required",
      },
    });

    for (const header of [
      "two words",
      "content/type",
      "header(name)",
      "café",
      "x-debug\0",
    ]) {
      expect(validateHeader(input({ header }))).toEqual({
        ok: false,
        error: {
          kind: "name-invalid",
          copyId: "header-name-invalid",
        },
      });
    }
  });

  it("rejects pseudo-header names with their dedicated error", () => {
    expect(validateHeader(input({ header: "  :Authority  " }))).toEqual({
      ok: false,
      error: {
        kind: "name-not-modifiable",
        copyId: "header-not-modifiable",
      },
    });
  });
});

describe("header value validation", () => {
  it("requires a value for set and append while allowing an empty value", () => {
    for (const operation of ["set", "append"] as const) {
      expect(
        validateHeader({ direction: "request", operation, header: "x-debug" }),
      ).toEqual({
        ok: false,
        error: {
          kind: "value-required",
          copyId: "header-value-required",
        },
      });
      expect(
        validateHeader(
          input({
            operation,
            header: operation === "append" ? "accept" : "x-debug",
            value: "",
          }),
        ),
      ).toMatchObject({
        ok: true,
        value: { value: "" },
      });
    }
  });

  it("rejects every CR and LF form without altering other free text", () => {
    for (const value of ["one\rtwo", "one\ntwo", "one\r\ntwo"]) {
      expect(validateHeader(input({ value }))).toEqual({
        ok: false,
        error: {
          kind: "value-line-break",
          copyId: "header-value-line-break",
        },
      });
    }

    const value = `Bearer {{uuid}} ${"x".repeat(10_000)}`;
    expect(validateHeader(input({ value }))).toMatchObject({
      ok: true,
      value: { value },
    });
  });

  it("omits the value for remove operations", () => {
    expect(
      validateHeader(input({ operation: "remove", value: "discarded\r\n" })),
    ).toEqual({
      ok: true,
      value: {
        header: "x-debug",
        classification: { requestAppend: "disallowed", advisories: [] },
      },
    });
  });
});

describe("request append classification", () => {
  it("contains exactly the fixed request-header allowlist", () => {
    expect(REQUEST_APPEND_HEADERS).toEqual([
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
    ]);
  });

  it("allows every allowlisted request append after save normalization", () => {
    for (const header of REQUEST_APPEND_HEADERS) {
      const result = validateHeader(
        input({
          operation: "append",
          header: ` ${header.toUpperCase()} `,
        }),
      );

      expect(result).toMatchObject({
        ok: true,
        value: {
          header,
          classification: { requestAppend: "allowed" },
        },
      });
    }
  });

  it("blocks non-allowlisted request append but not set or remove", () => {
    expect(
      validateHeader(input({ operation: "append", header: "X-Custom-Token" })),
    ).toEqual({
      ok: false,
      error: {
        kind: "request-append-not-allowed",
        copyId: "request-append-not-allowed",
        header: "x-custom-token",
      },
    });
    expect(validateHeader(input({ operation: "set" })).ok).toBe(true);
    expect(validateHeader(input({ operation: "remove" })).ok).toBe(true);
  });

  it("does not restrict response append", () => {
    expect(
      validateHeader(
        input({
          direction: "response",
          operation: "append",
          header: "x-custom-token",
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        header: "x-custom-token",
        classification: { requestAppend: "disallowed" },
      },
    });
  });
});

describe("header advisories", () => {
  it("classifies hop-by-hop and content-length names as network managed", () => {
    for (const header of [
      "connection",
      "keep-alive",
      "transfer-encoding",
      "upgrade",
      "te",
      "trailer",
      "content-length",
    ]) {
      expect(classifyHeaderName(header).advisories).toEqual([
        {
          kind: "network-managed",
          copyId: "header-network-managed",
        },
      ]);
    }
  });

  it("classifies host with its dedicated advisory", () => {
    expect(classifyHeaderName(" HOST ").advisories).toEqual([
      { kind: "host-http2", copyId: "header-host-http2" },
    ]);
  });

  it("classifies permitted hop-by-hop appends as both allowed and advisory", () => {
    for (const header of [
      "connection",
      "keep-alive",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ]) {
      expect(classifyHeaderName(header)).toEqual({
        requestAppend: "allowed",
        advisories: [
          {
            kind: "network-managed",
            copyId: "header-network-managed",
          },
        ],
      });
    }
  });

  it("recognizes credential headers by name and by the x-*-token shape", () => {
    for (const header of [
      "authorization",
      "proxy-authorization",
      "cookie",
      "set-cookie",
      "api-key",
      "x-api-key",
      "  X-Session-Token  ",
      "x-csrf-token",
    ]) {
      expect(isSecretHeader(header)).toBe(true);
    }
    for (const header of ["x-debug", "accept", "token", "x-token-count"]) {
      expect(isSecretHeader(header)).toBe(false);
    }
  });

  it("maps each error and advisory class to one distinct copy id", () => {
    const errorClasses = Object.keys(HEADER_ERROR_COPY_IDS);
    const errorCopyIds = Object.values(HEADER_ERROR_COPY_IDS);
    const advisoryClasses = Object.keys(HEADER_ADVISORY_COPY_IDS);
    const advisoryCopyIds = Object.values(HEADER_ADVISORY_COPY_IDS);

    expect(new Set(errorClasses).size).toBe(errorClasses.length);
    expect(new Set(errorCopyIds).size).toBe(errorCopyIds.length);
    expect(new Set(advisoryClasses).size).toBe(advisoryClasses.length);
    expect(new Set(advisoryCopyIds).size).toBe(advisoryCopyIds.length);
    expect(new Set([...errorCopyIds, ...advisoryCopyIds]).size).toBe(
      errorCopyIds.length + advisoryCopyIds.length,
    );
  });
});

describe("header sensitivity", () => {
  const credential = { kind: "credential", copyId: "header-credential" };
  const securityResponse = {
    kind: "security-response",
    copyId: "header-security-response",
  };

  it("cautions on any credential the rule writes, whichever direction carries it", () => {
    expect(headerSensitivity(input({ header: "authorization" }))).toEqual([
      credential,
    ]);
    expect(
      headerSensitivity(input({ header: "set-cookie", direction: "response" })),
    ).toEqual([credential]);
    expect(
      headerSensitivity(
        input({ header: "x-session-token", operation: "append" }),
      ),
    ).toEqual([credential]);
  });

  it("stays quiet when a rule strips a credential instead of writing one", () => {
    expect(
      headerSensitivity(
        input({ header: "authorization", operation: "remove" }),
      ),
    ).toEqual([]);
  });

  it("cautions on a response protection the rule sets or takes away", () => {
    for (const header of [
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
    ]) {
      for (const operation of ["set", "remove"] as const) {
        expect(
          headerSensitivity(
            input({ header, direction: "response", operation }),
          ),
        ).toEqual([securityResponse]);
      }
    }
  });

  it("stays quiet for an append, which can only add a further constraint", () => {
    expect(
      headerSensitivity(
        input({
          header: "content-security-policy",
          direction: "response",
          operation: "append",
        }),
      ),
    ).toEqual([]);
  });

  it("stays quiet on the request side, where the site never sent the protection", () => {
    expect(
      headerSensitivity(
        input({ header: "content-security-policy", direction: "request" }),
      ),
    ).toEqual([]);
  });

  it("stays quiet for an ordinary header", () => {
    expect(headerSensitivity(input({ header: "x-debug" }))).toEqual([]);
  });
});
