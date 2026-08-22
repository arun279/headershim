import { describe, expect, it } from "vitest";
import { originFromUrl } from "./tabs";

describe("originFromUrl", () => {
  it("keeps the tab's scheme and non-default port", () => {
    expect(originFromUrl("http://localhost:8787/api")).toBe(
      "http://localhost:8787",
    );
    expect(originFromUrl("https://app.example.com/dashboard")).toBe(
      "https://app.example.com",
    );
  });

  it("rejects unavailable and non-web URLs", () => {
    expect(originFromUrl(undefined)).toBeUndefined();
    expect(originFromUrl("chrome://extensions")).toBeUndefined();
    expect(originFromUrl("not a url")).toBeUndefined();
  });
});
