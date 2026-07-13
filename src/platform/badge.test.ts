import { fakeBrowser } from "@webext-core/fake-browser";
import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { BadgeState } from "../core/badge";
import { applyBadge } from "./badge";

async function openTab(): Promise<number> {
  const { id } = await fakeBrowser.tabs.create({});
  if (id === undefined) {
    throw new Error("fake tab has no id");
  }
  return id;
}

function manual(text: string): BadgeState {
  return {
    kind: "manual",
    text,
    backgroundColor: "#3344aa",
    textColor: "#ffffff",
  };
}

describe("badge adapter", () => {
  it("disables managed counts before painting and sweeps stale tab text", async () => {
    const tabId = await openTab();
    await browser.action.setBadgeText({ tabId, text: "T" });
    const setOptions = vi
      .spyOn(browser.declarativeNetRequest, "setExtensionActionOptions")
      .mockResolvedValue();
    const setText = vi.spyOn(browser.action, "setBadgeText");

    await applyBadge(manual(""), []);

    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: false,
    });
    expect(setOptions.mock.invocationCallOrder[0]).toBeLessThan(
      setText.mock.invocationCallOrder[0] ?? 0,
    );
    expect(await browser.action.getBadgeText({ tabId })).toBe("");
  });

  it("paints planned tab text and resets ended tabs to the global badge", async () => {
    vi.spyOn(
      browser.declarativeNetRequest,
      "setExtensionActionOptions",
    ).mockResolvedValue();
    const overridden = await openTab();
    const ended = await openTab();
    await browser.action.setBadgeText({ tabId: ended, text: "T" });
    const setText = vi.spyOn(browser.action, "setBadgeText");

    await applyBadge(manual("QA"), [{ tabId: overridden, text: "T" }]);

    expect(await browser.action.getBadgeText({ tabId: overridden })).toBe("T");
    // Passing no text drops the tab-specific value so the global text shows.
    expect(setText).toHaveBeenCalledWith({ tabId: ended });
    expect(await browser.action.getBadgeText({ tabId: ended })).toBe("");
  });

  it("clears manual text everywhere before enabling managed counts", async () => {
    const setOptions = vi
      .spyOn(browser.declarativeNetRequest, "setExtensionActionOptions")
      .mockResolvedValue();
    const tabId = await openTab();
    await browser.action.setBadgeText({ text: "QA" });
    await browser.action.setBadgeText({ tabId, text: "T" });

    await applyBadge(
      { kind: "count", backgroundColor: "#3344aa", textColor: "#ffffff" },
      [],
    );

    expect(await browser.action.getBadgeText({})).toBe("");
    expect(setOptions).toHaveBeenCalledWith({
      displayActionCountAsBadgeText: true,
    });
    expect(await browser.action.getBadgeText({ tabId })).toBe("");
  });
});
