import { browser } from "wxt/browser";
import type { RegexValidator } from "../core/codec/modheader";
import type { DnrRule } from "../core/compile";
import type { StateDoc } from "../core/model";
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

// The real DNR surface, bound to the same contract FakeDnr implements: the
// `satisfies` makes any drift between an export and DnrAdapter a build error,
// so the interface constrains the code under test, not just the fake.
const dnr = {
  getDynamicRules(): Promise<DnrRule[]> {
    return browser.declarativeNetRequest.getDynamicRules() as Promise<
      DnrRule[]
    >;
  },
  updateDynamicRules(options: UpdateRulesOptions): Promise<void> {
    return browser.declarativeNetRequest.updateDynamicRules(options);
  },
  getSessionRules(): Promise<DnrRule[]> {
    return browser.declarativeNetRequest.getSessionRules() as Promise<
      DnrRule[]
    >;
  },
  updateSessionRules(options: UpdateRulesOptions): Promise<void> {
    return browser.declarativeNetRequest.updateSessionRules(options);
  },
  isRegexSupported: async (regex) => {
    const result = await browser.declarativeNetRequest.isRegexSupported({
      regex,
    });
    return result.isSupported
      ? ok(undefined)
      : err(result.reason ?? "unsupported");
  },
  setExtensionActionOptions(options: ExtensionActionOptions): Promise<void> {
    return browser.declarativeNetRequest.setExtensionActionOptions(options);
  },
} satisfies DnrAdapter;

export const {
  getDynamicRules,
  updateDynamicRules,
  getSessionRules,
  updateSessionRules,
  isRegexSupported,
  setExtensionActionOptions,
} = dnr;

export async function resolveRegexSupport(
  doc: StateDoc,
): Promise<(regex: string) => boolean> {
  const regexes = new Set<string>();
  for (const profile of doc.profiles) {
    if (profile.id !== doc.activeProfileId) continue;
    for (const rule of profile.rules) {
      if (rule.enabled && rule.scope.type === "regex") {
        regexes.add(rule.scope.regex);
      }
    }
  }
  const supported = new Set<string>();
  await Promise.all(
    [...regexes].map(async (regex) => {
      if ((await isRegexSupported(regex)).ok) {
        supported.add(regex);
      }
    }),
  );
  return (regex) => supported.has(regex);
}
