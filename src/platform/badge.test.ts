import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { BadgeState, TabBadgeText } from "../core/badge";
import { applyBadge } from "./badge";

const tabBadges: TabBadgeText[] = [
  { tabId: 11, text: "T" },
  { tabId: 12, text: "2" },
];

describe("badge adapter", () => {
  it("disables managed counts before painting and sweeps global tab text", async () => {
    const setOptions = vi
      .spyOn(browser.declarativeNetRequest, "setExtensionActionOptions")
      .mockResolvedValue();
    const setText = vi.spyOn(browser.action, "setBadgeText");
    const state: BadgeState = {
      kind: "manual",
      global: true,
      text: "",
      backgroundColor: "#777777",
      textColor: "#ffffff",
    };

    await applyBadge(state, tabBadges);

    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: false,
    });
    expect(setOptions.mock.invocationCallOrder[0]).toBeLessThan(
      setText.mock.invocationCallOrder[0] ?? 0,
    );
    expect(await browser.action.getBadgeText({ tabId: 11 })).toBe("");
    expect(await browser.action.getBadgeText({ tabId: 12 })).toBe("");
  });

  it("repaints tab text in manual content states", async () => {
    vi.spyOn(
      browser.declarativeNetRequest,
      "setExtensionActionOptions",
    ).mockResolvedValue();
    const state: BadgeState = {
      kind: "manual",
      global: false,
      text: "QA",
      backgroundColor: "#3344aa",
      textColor: "#ffffff",
    };

    await applyBadge(state, tabBadges);

    expect(await browser.action.getBadgeText({ tabId: 11 })).toBe("T");
    expect(await browser.action.getBadgeText({ tabId: 12 })).toBe("2");
  });

  it("clears manual text before enabling managed counts", async () => {
    const setOptions = vi
      .spyOn(browser.declarativeNetRequest, "setExtensionActionOptions")
      .mockResolvedValue();
    await browser.action.setBadgeText({ text: "QA" });

    await applyBadge(
      {
        kind: "count",
        backgroundColor: "#3344aa",
        textColor: "#ffffff",
      },
      tabBadges,
    );

    expect(await browser.action.getBadgeText({})).toBe("");
    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: true,
    });
    expect(await browser.action.getBadgeText({ tabId: 11 })).toBe("");
  });
});
