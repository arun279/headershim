import { describe, expect, it, vi } from "vitest";
import {
  addHostAccessRequest,
  contains,
  onChanged,
  remove,
  request,
  snapshot,
} from "./permissions";

describe("platform permissions", () => {
  it.each([
    "*://*/*",
    "<all_urls>",
  ])("marks %s as an all-sites grant", async (origin) => {
    await request([origin]);

    expect(await snapshot()).toEqual({ origins: [origin], allSites: true });
  });

  it("marshals containment, changes, removal, and optional affordances", async () => {
    const origin = "*://*.example.com/*";
    const changed = vi.fn();
    const unsubscribe = onChanged(changed);

    expect(await contains([origin])).toBe(false);
    expect(await request([origin])).toBe(true);
    expect(await contains([origin])).toBe(true);
    expect(await snapshot()).toEqual({ origins: [origin], allSites: false });
    expect(await remove([origin])).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    await expect(addHostAccessRequest({ tabId: 7 })).resolves.toBeUndefined();

    unsubscribe();
  });
});
