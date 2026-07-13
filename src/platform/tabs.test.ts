import { describe, expect, it } from "vitest";
import { domainFromUrl } from "./tabs";

describe("domainFromUrl", () => {
  it("returns the hostname for web origins only", () => {
    expect(domainFromUrl("https://app.example.com/dashboard?x=1")).toBe(
      "app.example.com",
    );
    expect(domainFromUrl("http://localhost:8787/api")).toBe("localhost");
  });

  it("returns undefined for chrome pages, invalid URLs, and missing tabs", () => {
    expect(domainFromUrl(undefined)).toBeUndefined();
    expect(domainFromUrl("chrome://extensions")).toBeUndefined();
    expect(domainFromUrl("about:blank")).toBeUndefined();
    expect(domainFromUrl("not a url")).toBeUndefined();
  });
});
