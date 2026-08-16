import { describe, expect, it } from "vitest";
import { domainFromUrl, originFromUrl } from "./tabs";

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
