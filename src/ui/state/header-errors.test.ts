import { describe, expect, it } from "vitest";
import type { HeaderValidationError } from "../../core/headers";
import { copy } from "../copy";
import {
  headerErrorToFieldError,
  headerValueEmptyErrors,
} from "./header-errors";

describe("headerValueEmptyErrors", () => {
  it("flags a missing name and value", () => {
    expect(
      headerValueEmptyErrors({ operation: "set", header: "  ", value: "" }),
    ).toEqual({
      name: copy.errors.headerNameRequired,
      value: copy.errors.valueRequired,
    });
  });

  it("does not require a value for remove", () => {
    expect(
      headerValueEmptyErrors({ operation: "remove", header: "x-a", value: "" }),
    ).toBeUndefined();
  });

  it("passes a complete set/append draft", () => {
    expect(
      headerValueEmptyErrors({ operation: "set", header: "x-a", value: "1" }),
    ).toBeUndefined();
  });
});

describe("headerErrorToFieldError", () => {
  const cases: Array<[HeaderValidationError, Record<string, string>]> = [
    [
      { kind: "name-required", copyId: "header-name-required" },
      { name: copy.errors.headerNameRequired },
    ],
    [
      { kind: "name-invalid", copyId: "header-name-invalid" },
      { name: copy.errors.headerNameInvalid },
    ],
    [
      { kind: "name-not-modifiable", copyId: "header-not-modifiable" },
      { name: copy.errors.headerNotModifiable },
    ],
    [
      { kind: "value-required", copyId: "header-value-required" },
      { value: copy.errors.valueRequired },
    ],
    [
      { kind: "value-line-break", copyId: "header-value-line-break" },
      { value: copy.errors.valueLineBreak },
    ],
    [
      {
        kind: "request-append-not-allowed",
        copyId: "request-append-not-allowed",
        header: "x-custom",
      },
      { operation: copy.errors.appendDisallowed("x-custom") },
    ],
  ];

  it.each(cases)("maps %o to its inline field copy", (error, expected) => {
    expect(headerErrorToFieldError(error)).toEqual(expected);
  });
});
