import type { DnrRule } from "../core/compile";
import { allowsRequestAppend, HTTP_TOKEN } from "../core/headers";
import { MAX_DYNAMIC_RULES, MAX_REGEX_RULES } from "../core/limits";
import { ok } from "../core/result";
import type { DnrAdapter, UpdateRulesOptions } from "./dnr";

const MAX_SESSION_RULES = 5_000;

export class FakeDnr implements DnrAdapter {
  dynamicRules: DnrRule[] = [];
  sessionRules: DnrRule[] = [];

  async getDynamicRules() {
    return [...this.dynamicRules];
  }
  async updateDynamicRules(options: UpdateRulesOptions) {
    this.dynamicRules = update(
      this.dynamicRules,
      options,
      false,
      MAX_DYNAMIC_RULES,
    );
  }
  async getSessionRules() {
    return [...this.sessionRules];
  }
  async updateSessionRules(options: UpdateRulesOptions) {
    this.sessionRules = update(
      this.sessionRules,
      options,
      true,
      MAX_SESSION_RULES,
    );
  }
  async isRegexSupported(_regex: string) {
    return ok(undefined);
  }
}

function update(
  rules: DnrRule[],
  options: UpdateRulesOptions,
  allowTabIds: boolean,
  maxRules: number,
): DnrRule[] {
  const removed = new Set(options.removeRuleIds ?? []);
  const next = rules
    .filter((rule) => !removed.has(rule.id))
    .concat(options.addRules ?? []);
  validateRules(next, allowTabIds, maxRules);
  return next;
}

function validateRules(
  rules: readonly DnrRule[],
  allowTabIds: boolean,
  maxRules: number,
): void {
  if (rules.length > maxRules) {
    throw new Error("Invalid DNR rule");
  }
  const ids = new Set<number>();
  let regexRules = 0;
  for (const rule of rules) {
    if (rule.condition.regexFilter !== undefined) {
      regexRules += 1;
    }
    if (
      regexRules > MAX_REGEX_RULES ||
      !Number.isSafeInteger(rule.id) ||
      rule.id < 1 ||
      !Number.isSafeInteger(rule.priority) ||
      rule.priority < 1 ||
      ids.has(rule.id) ||
      !validAction(rule) ||
      !validCondition(rule, allowTabIds)
    ) {
      throw new Error("Invalid DNR rule");
    }
    ids.add(rule.id);
  }
}

function validAction(rule: DnrRule): boolean {
  const { requestHeaders, responseHeaders } = rule.action;
  if (
    (requestHeaders !== undefined && requestHeaders.length === 0) ||
    (responseHeaders !== undefined && responseHeaders.length === 0) ||
    (requestHeaders === undefined && responseHeaders === undefined)
  ) {
    return false;
  }
  return (
    requestHeaders?.every(
      (modification) =>
        validModification(modification) &&
        (modification.operation !== "append" ||
          allowsRequestAppend(modification.header.toLowerCase())),
    ) !== false && responseHeaders?.every(validModification) !== false
  );
}

function validModification(
  modification: NonNullable<DnrRule["action"]["requestHeaders"]>[number],
): boolean {
  if (!HTTP_TOKEN.test(modification.header)) {
    return false;
  }
  if (modification.operation === "remove") {
    return modification.value === undefined;
  }
  return (
    modification.value !== undefined && !/[\0\r\n]/u.test(modification.value)
  );
}

function validCondition(rule: DnrRule, allowTabIds: boolean): boolean {
  const {
    initiatorDomains,
    regexFilter,
    requestDomains,
    resourceTypes,
    tabIds,
    urlFilter,
  } = rule.condition;
  if (
    [initiatorDomains, requestDomains, resourceTypes, tabIds].some(
      (values) => values !== undefined && values.length === 0,
    ) ||
    (!allowTabIds && tabIds !== undefined) ||
    [...(initiatorDomains ?? []), ...(requestDomains ?? [])].some(
      (domain) => !isAscii(domain),
    ) ||
    (urlFilter !== undefined &&
      (urlFilter.length === 0 ||
        !isAscii(urlFilter) ||
        urlFilter.startsWith("||*"))) ||
    (urlFilter !== undefined && regexFilter !== undefined)
  ) {
    return false;
  }
  return (
    regexFilter === undefined ||
    (regexFilter.length > 0 && isAscii(regexFilter))
  );
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return false;
    }
  }
  return true;
}
