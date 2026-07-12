import { describe, expect, it } from "vitest";
import { COMMON_HEADER_NAMES } from "./header-names";
import { REQUEST_APPEND_HEADERS, validateHeader } from "./headers";

describe("COMMON_HEADER_NAMES", () => {
  it("provides a deterministic bundled list of valid common names", () => {
    expect(COMMON_HEADER_NAMES).toContain("authorization");
    expect(COMMON_HEADER_NAMES).toContain("content-type");
    expect(COMMON_HEADER_NAMES).toContain("set-cookie");
    expect(COMMON_HEADER_NAMES).toContain("x-forwarded-for");
    expect(COMMON_HEADER_NAMES).toEqual([...COMMON_HEADER_NAMES].sort());
    expect(new Set(COMMON_HEADER_NAMES).size).toBe(COMMON_HEADER_NAMES.length);

    for (const header of COMMON_HEADER_NAMES) {
      expect(
        validateHeader({
          direction: "request",
          operation: "set",
          header,
          value: "",
        }).ok,
      ).toBe(true);
    }
  });

  it("includes every request append suggestion", () => {
    for (const header of REQUEST_APPEND_HEADERS) {
      expect(COMMON_HEADER_NAMES).toContain(header);
    }
  });
});
