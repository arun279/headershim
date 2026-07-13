import type { DnrRule } from "./compile";

export interface ReconcilePlan {
  removeRuleIds: number[];
  addRules: DnrRule[];
}

export function normalize(rules: DnrRule[]): DnrRule[] {
  return rules.map((rule) => ({
    action: {
      requestHeaders: normalizeHeaderModifications(rule.action.requestHeaders),
      responseHeaders: normalizeHeaderModifications(
        rule.action.responseHeaders,
      ),
      type: rule.action.type,
    },
    condition: {
      ...(rule.condition.initiatorDomains === undefined
        ? {}
        : { initiatorDomains: [...rule.condition.initiatorDomains] }),
      ...(rule.condition.regexFilter === undefined
        ? {}
        : { regexFilter: rule.condition.regexFilter }),
      ...(rule.condition.requestDomains === undefined
        ? {}
        : { requestDomains: [...rule.condition.requestDomains] }),
      resourceTypes: [...rule.condition.resourceTypes],
      ...(rule.condition.tabIds === undefined
        ? {}
        : { tabIds: [...rule.condition.tabIds] }),
      ...(rule.condition.urlFilter === undefined
        ? {}
        : { urlFilter: rule.condition.urlFilter }),
    },
    id: rule.id,
    priority: rule.priority,
  }));
}

function normalizeHeaderModifications(
  modifications: DnrRule["action"]["requestHeaders"],
) {
  return (modifications ?? []).map((modification) => ({
    header: modification.header,
    operation: modification.operation,
    ...(modification.value === undefined ? {} : { value: modification.value }),
  }));
}

export function planReconcile(
  desired: DnrRule[],
  actual: DnrRule[],
): ReconcilePlan | null {
  const desiredRules = normalize(desired)
    .map((rule) => JSON.stringify(rule))
    .sort();
  const actualRules = normalize(actual)
    .map((rule) => JSON.stringify(rule))
    .sort();

  if (
    desiredRules.length === actualRules.length &&
    desiredRules.every((rule, index) => rule === actualRules[index])
  ) {
    return null;
  }

  return {
    removeRuleIds: actual.map((rule) => rule.id),
    addRules: desired,
  };
}
