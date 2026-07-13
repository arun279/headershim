import { browser } from "wxt/browser";
import type { BadgeState, TabBadgeText } from "../core/badge";
import { setExtensionActionOptions } from "./dnr";

export async function applyBadge(
  state: BadgeState,
  tabBadges: readonly TabBadgeText[],
): Promise<void> {
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

  // Tab-scoped text outlives the override that painted it (Chrome resets it
  // only on navigation or close), so every paint sweeps all open tabs and
  // restores the ones no longer in the plan to the global badge.
  const textByTab = new Map(tabBadges.map(({ tabId, text }) => [tabId, text]));
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map(({ id }) => {
      if (id === undefined) {
        return undefined;
      }
      const text = textByTab.get(id);
      return browser.action.setBadgeText(
        text === undefined ? { tabId: id } : { tabId: id, text },
      );
    }),
  );
}
