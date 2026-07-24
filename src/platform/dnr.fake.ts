import type { DnrRule } from "../core/compile";
import { ok } from "../core/result";
import type { DnrAdapter, UpdateRulesOptions } from "./dnr";

export class FakeDnr implements DnrAdapter {
  dynamicRules: DnrRule[] = [];
  sessionRules: DnrRule[] = [];

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
}

function update(rules: DnrRule[], options: UpdateRulesOptions): DnrRule[] {
  const removed = new Set(options.removeRuleIds ?? []);
  return rules
    .filter((rule) => !removed.has(rule.id))
    .concat(options.addRules ?? []);
}
