import { describe, expect, it } from "vitest";
import { truncateForBadge } from "./truncate-for-badge";

describe("truncateForBadge", () => {
  it("preserves empty and boundary-length labels", () => {
    expect(truncateForBadge("", 4)).toBe("");
    expect(truncateForBadge("RULE", 4)).toBe("RULE");
  });

  it("replaces the final available grapheme with an ellipsis", () => {
    expect(truncateForBadge("ACTIVE", 4)).toBe("ACT…");
    expect(truncateForBadge("ACTIVE", 1)).toBe("…");
    expect(truncateForBadge("ACTIVE", 0)).toBe("");
  });

  it("does not split Unicode grapheme clusters", () => {
    expect(truncateForBadge("A👩🏽‍💻BC", 3)).toBe("A👩🏽‍💻…");
    expect(truncateForBadge("🇺🇸USA", 3)).toBe("🇺🇸U…");
  });

  it("rejects invalid limits", () => {
    expect(() => truncateForBadge("RULE", -1)).toThrow(RangeError);
    expect(() => truncateForBadge("RULE", 1.5)).toThrow(RangeError);
  });
});
