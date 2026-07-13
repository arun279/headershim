import { browser } from "wxt/browser";
import type { RegexValidator } from "../core/codec/modheader";
import type { DnrRule } from "../core/compile";
import { err, ok } from "../core/result";

export interface UpdateRulesOptions {
  addRules?: DnrRule[];
  removeRuleIds?: number[];
}

export interface ExtensionActionOptions {
  displayActionCountAsBadgeText?: boolean;
  tabUpdate?: { increment: number; tabId: number };
}

export interface DnrAdapter {
  getDynamicRules(): Promise<DnrRule[]>;
  updateDynamicRules(options: UpdateRulesOptions): Promise<void>;
  getSessionRules(): Promise<DnrRule[]>;
  updateSessionRules(options: UpdateRulesOptions): Promise<void>;
  isRegexSupported: RegexValidator;
  setExtensionActionOptions(options: ExtensionActionOptions): Promise<void>;
}

export function getDynamicRules(): Promise<DnrRule[]> {
  return browser.declarativeNetRequest.getDynamicRules() as Promise<DnrRule[]>;
}

export function updateDynamicRules(options: UpdateRulesOptions): Promise<void> {
  return browser.declarativeNetRequest.updateDynamicRules(options);
}

export function getSessionRules(): Promise<DnrRule[]> {
  return browser.declarativeNetRequest.getSessionRules() as Promise<DnrRule[]>;
}

export function updateSessionRules(options: UpdateRulesOptions): Promise<void> {
  return browser.declarativeNetRequest.updateSessionRules(options);
}

export const isRegexSupported: RegexValidator = async (regex) => {
  const result = await browser.declarativeNetRequest.isRegexSupported({
    regex,
  });
  return result.isSupported
    ? ok(undefined)
    : err(result.reason ?? "unsupported");
};

export function setExtensionActionOptions(
  options: ExtensionActionOptions,
): Promise<void> {
  return browser.declarativeNetRequest.setExtensionActionOptions(options);
}
