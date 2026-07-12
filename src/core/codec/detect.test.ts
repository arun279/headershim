import { describe, expect, it } from "vitest";
import { detectImportFormat } from "./detect";

describe("detectImportFormat", () => {
  it("recognizes a headershim envelope by its format markers", () => {
    expect(detectImportFormat({ app: "headershim", schemaVersion: 1 })).toBe(
      "headershim",
    );
    expect(
      detectImportFormat({ app: "headershim", schemaVersion: "future" }),
    ).toBe("headershim");
  });

  it("recognizes only nonempty arrays with characteristic profile fields", () => {
    expect(detectImportFormat([{ title: "Default" }])).toBe("modheader");
    expect(detectImportFormat([{ headers: [] }, { respHeaders: [] }])).toBe(
      "modheader",
    );

    for (const value of [
      [],
      [null],
      [{ name: "Default" }],
      [{ title: "Default" }, null],
    ]) {
      expect(detectImportFormat(value)).toBe("unknown");
    }
  });

  it("leaves other JSON shapes unclassified", () => {
    for (const value of [
      null,
      "headershim",
      { app: "headershim" },
      { schemaVersion: 1 },
      { app: "another", schemaVersion: 1 },
    ]) {
      expect(detectImportFormat(value)).toBe("unknown");
    }
  });
});
