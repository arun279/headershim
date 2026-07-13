import type { DnrRule } from "../core/compile";
import { ok } from "../core/result";
import type {
  DnrAdapter,
  ExtensionActionOptions,
  UpdateRulesOptions,
} from "./dnr";

export class FakeDnr implements DnrAdapter {
  dynamicRules: DnrRule[] = [];
  sessionRules: DnrRule[] = [];
  extensionActionOptions: ExtensionActionOptions[] = [];

  async getDynamicRules() {
    return [...this.dynamicRules];
  }
  async updateDynamicRules(options: UpdateRulesOptions) {
    this.dynamicRules = update(this.dynamicRules, options);
  }
  async getSessionRules() {
    return [...this.sessionRules];
  }
  async updateSessionRules(options: UpdateRulesOptions) {
    this.sessionRules = update(this.sessionRules, options);
  }
  async isRegexSupported(_regex: string) {
    return ok(undefined);
  }
  async setExtensionActionOptions(options: ExtensionActionOptions) {
    this.extensionActionOptions.push(options);
  }
}

function update(rules: DnrRule[], options: UpdateRulesOptions): DnrRule[] {
  const removed = new Set(options.removeRuleIds ?? []);
  return rules
    .filter((rule) => !removed.has(rule.id))
    .concat(options.addRules ?? []);
}
