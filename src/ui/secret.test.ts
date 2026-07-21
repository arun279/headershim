import { describe, expect, it } from "vitest";
import { copy } from "./copy";
import { headerValueSummary, ruleValueSummary } from "./secret";

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

  it("labels generated metadata when its literal value is absent", () => {
    expect(
      ruleValueSummary({
        header: "x-trace-id",
        value: "",
        generated: { kind: "uuid", at: "2026-07-12T14:03:00.000Z" },
      }),
    ).toBe(copy.rules.generated(copy.editor.generatedKind.uuid));
  });
});
