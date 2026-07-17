import { describe, expect, it } from "vitest";
import { copy } from "./copy";
import { headerValueSummary } from "./secret";

describe("headerValueSummary", () => {
  it("redacts a secret value, keeping the scheme word readable", () => {
    expect(headerValueSummary("authorization", "Bearer eyJhbGci.abc.def")).toBe(
      `Bearer ${copy.rules.redacted}`,
    );
    expect(headerValueSummary("x-api-key", "k-123")).toBe(copy.rules.redacted);
  });

  it("passes a non-secret header's value through untouched", () => {
    expect(headerValueSummary("accept", "application/json")).toBe(
      "application/json",
    );
  });

  it("leaves a removal's absent value absent", () => {
    expect(headerValueSummary("authorization", undefined)).toBeUndefined();
  });

  it("does not redact an empty value, which withholds nothing", () => {
    expect(headerValueSummary("authorization", "")).toBe("");
  });
});
