import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { BadgeState } from "../core/badge";
import { applyBadge } from "./badge";

function manual(text: string): BadgeState {
  return {
    kind: "manual",
    text,
    backgroundColor: "#3344aa",
    textColor: "#ffffff",
  };
}

describe("badge adapter", () => {
  it("disables managed counts before painting manual text", async () => {
    const setOptions = vi
      .spyOn(browser.declarativeNetRequest, "setExtensionActionOptions")
      .mockResolvedValue();
    const setText = vi.spyOn(browser.action, "setBadgeText");

    await applyBadge(manual(""), "");

    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: false,
    });
    expect(setOptions.mock.invocationCallOrder[0]).toBeLessThan(
      setText.mock.invocationCallOrder[0] ?? 0,
    );
    expect(await browser.action.getBadgeText({})).toBe("");
  });

  it("clears manual text before enabling managed counts", async () => {
    const setOptions = vi
      .spyOn(browser.declarativeNetRequest, "setExtensionActionOptions")
      .mockResolvedValue();
    await browser.action.setBadgeText({ text: "QA" });

    await applyBadge(
      { kind: "count", backgroundColor: "#3344aa", textColor: "#ffffff" },
      "",
    );

    expect(await browser.action.getBadgeText({})).toBe("");
    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: true,
    });
  });

  it("sets the paused tooltip and clears it back to the default title", async () => {
    vi.spyOn(
      browser.declarativeNetRequest,
      "setExtensionActionOptions",
    ).mockResolvedValue();
    const setTitle = vi.spyOn(browser.action, "setTitle");

    await applyBadge(manual(""), "HeaderShim: paused");
    expect(setTitle).toHaveBeenCalledWith({ title: "HeaderShim: paused" });

    await applyBadge(manual("QA"), "");
    expect(setTitle).toHaveBeenLastCalledWith({ title: "" });
  });
});
