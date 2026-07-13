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

  if (state.kind === "count") {
    return;
  }

  if (state.global) {
    await Promise.all(
      tabBadges.map(({ tabId }) =>
        browser.action.setBadgeText({ tabId, text: "" }),
      ),
    );
    return;
  }

  await Promise.all(
    tabBadges.map(({ tabId, text }) =>
      browser.action.setBadgeText({ tabId, text }),
    ),
  );
}
