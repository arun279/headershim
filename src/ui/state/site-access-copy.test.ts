import { describe, expect, it } from "vitest";
import { ALL_SITES_ORIGIN } from "../../core/grants";
import { revokeMessage } from "./site-access-copy";

describe("revokeMessage", () => {
  it("reads the outcome, not the intent, and names what still covers the host", () => {
    expect(revokeMessage("changed", "api.example.com", [])).toBe(
      "Access to api.example.com revoked",
    );
    expect(
      revokeMessage("changed", "api.example.com", [ALL_SITES_ORIGIN]),
    ).toBe(
      "Access to api.example.com revoked; all-sites access still covers it",
    );
    // The row's own grant is gone, but a parent-domain grant reaches the host
    // just as it did before the click, so the line names the grant that stayed.
    expect(
      revokeMessage("changed", "api.example.com", ["https://*.example.com/*"]),
    ).toBe(
      "Access to api.example.com revoked; https://*.example.com still covers it",
    );
    expect(
      revokeMessage("changed", "api.example.com", [
        ALL_SITES_ORIGIN,
        "https://*.example.com/*",
      ]),
    ).toBe(
      "Access to api.example.com revoked; all-sites access and https://*.example.com still cover it",
    );
    // Nothing was there to remove: the grant went away between the render and
    // the click, so the line says what is true instead of claiming the act.
    expect(revokeMessage("unchanged", "api.example.com", [])).toBe(
      "No direct grant for api.example.com",
    );
    expect(
      revokeMessage("unchanged", "api.example.com", [ALL_SITES_ORIGIN]),
    ).toBe(
      "No direct grant for api.example.com; all-sites access still covers it",
    );
    expect(revokeMessage("failed", "api.example.com", [])).toBe(
      "Site grant for api.example.com could not be removed",
    );
    expect(revokeMessage("failed", "api.example.com", [ALL_SITES_ORIGIN])).toBe(
      "Site grant for api.example.com could not be removed",
    );
  });
});
