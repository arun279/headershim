import { browser } from "wxt/browser";
import type { BadgeState } from "../core/badge";
import { setExtensionActionOptions } from "./dnr";

export async function applyBadge(
  state: BadgeState,
  title: string,
): Promise<void> {
  // An empty title resets the button to its manifest default_title; only the
  // paused state carries its own tooltip.
  await browser.action.setTitle({ title });

  if (state.kind === "count") {
    await browser.action.setBadgeText({ text: "" });
    await setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  } else {
    await setExtensionActionOptions({ displayActionCountAsBadgeText: false });
    await browser.action.setBadgeText({ text: state.text });
  }

  await Promise.all([
    browser.action.setBadgeBackgroundColor({ color: state.backgroundColor }),
    browser.action.setBadgeTextColor({ color: state.textColor }),
  ]);
}
