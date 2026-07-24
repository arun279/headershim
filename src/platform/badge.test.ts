import { describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { BadgeState } from "../core/badge";
import { applyBadge } from "./badge";

function state(text: string): BadgeState {
  return { text, backgroundColor: "#3344aa", textColor: "#ffffff" };
}

describe("badge adapter", () => {
  it("paints the badge text, colours, and tooltip", async () => {
    const setBackground = vi.spyOn(browser.action, "setBadgeBackgroundColor");
    const setTextColor = vi.spyOn(browser.action, "setBadgeTextColor");
    const setTitle = vi.spyOn(browser.action, "setTitle");

    await applyBadge(state("PR"), "HeaderShim: paused");

    expect(await browser.action.getBadgeText({})).toBe("PR");
    expect(setBackground).toHaveBeenCalledWith({ color: "#3344aa" });
    expect(setTextColor).toHaveBeenCalledWith({ color: "#ffffff" });
    expect(setTitle).toHaveBeenCalledWith({ title: "HeaderShim: paused" });
  });

  it("clears the tooltip back to the default title", async () => {
    const setTitle = vi.spyOn(browser.action, "setTitle");

    await applyBadge(state(""), "");

    expect(setTitle).toHaveBeenCalledWith({ title: "" });
    expect(await browser.action.getBadgeText({})).toBe("");
  });
});
