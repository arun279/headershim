import { browser } from "wxt/browser";
import type { BadgeState } from "../core/badge";

export async function applyBadge(
  state: BadgeState,
  title: string,
): Promise<void> {
  // An empty title resets the button to its manifest default_title; only the
  // paused state carries its own tooltip.
  await Promise.all([
    browser.action.setTitle({ title }),
    browser.action.setBadgeText({ text: state.text }),
    browser.action.setBadgeBackgroundColor({ color: state.backgroundColor }),
    browser.action.setBadgeTextColor({ color: state.textColor }),
  ]);
}
