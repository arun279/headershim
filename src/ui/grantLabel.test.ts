import { describe, expect, it } from "vitest";
import { ALL_SITES_ORIGIN } from "../core/grants";
import { copy } from "./copy";
import { grantLabel } from "./grantLabel";

describe("grantLabel", () => {
  it("names broad access when the only missing origin is all sites", () => {
    expect(grantLabel([ALL_SITES_ORIGIN])).toBe(copy.readout.grantAllSites);
    expect(grantLabel(["*://*.example.com/*", "<all_urls>"])).toBe(
      copy.readout.grantAllSites,
    );
  });

  it("stays the plain Grant for narrower or absent origins", () => {
    expect(grantLabel(["*://*.example.com/*"])).toBe(copy.readout.grant);
    expect(grantLabel(undefined)).toBe(copy.readout.grant);
  });
});
