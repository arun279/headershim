import { browser } from "wxt/browser";
import type { BadgePlan } from "../core/badge";

export async function applyBadge(plan: BadgePlan): Promise<void> {
  // An empty title resets the button to its manifest default_title; only the
  // paused state carries its own tooltip.
  await Promise.all([
    browser.action.setTitle({ title: plan.title }),
    browser.action.setBadgeText({ text: plan.text }),
    browser.action.setBadgeBackgroundColor({ color: plan.backgroundColor }),
    browser.action.setBadgeTextColor({ color: plan.textColor }),
  ]);
}
