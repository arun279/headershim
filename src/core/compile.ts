import {
  MAX_ENABLED_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "./limits";
import type { HeaderOp, Rule, StateDoc, TabOverride } from "./model";
import {
  type DnrResourceType,
  expandResourceTypes,
  scopeCondition,
} from "./scope";

export const DYNAMIC_PRIORITY_TOP = 5_000;
export const SESSION_PRIORITY_TOP = 10_000;

interface DnrHeaderModification {
  header: string;
  operation: HeaderOp;
  value?: string;
}

interface DnrRuleAction {
  type: "modifyHeaders";
  requestHeaders?: DnrHeaderModification[];
  responseHeaders?: DnrHeaderModification[];
}

interface DnrRuleCondition {
  requestDomains?: string[];
  initiatorDomains?: string[];
  urlFilter?: string;
  regexFilter?: string;
  resourceTypes: DnrResourceType[];
  tabIds?: number[];
}

export interface DnrRule {
  id: number;
  priority: number;
  action: DnrRuleAction;
  condition: DnrRuleCondition;
}

export function compileDynamic(state: StateDoc): DnrRule[] {
  const enabledRules = state.profiles.flatMap((profile) =>
    profile.enabled ? profile.rules.filter((rule) => rule.enabled) : [],
  );
  if (enabledRules.length > MAX_ENABLED_RULES) {
    throw new RangeError(
      `Cannot compile ${enabledRules.length} enabled rules; the limit is ${MAX_ENABLED_RULES}`,
    );
  }
  const regexCount = enabledRules.filter(
    (rule) => rule.scope.type === "regex",
  ).length;
  if (regexCount > MAX_REGEX_RULES) {
    throw new RangeError(
      `Cannot compile ${regexCount} regex rules; the limit is ${MAX_REGEX_RULES}`,
    );
  }
  if (state.settings.paused) {
    return [];
  }

  return enabledRules.map((rule, index) => ({
    id: rule.num,
    priority: DYNAMIC_PRIORITY_TOP - index,
    action: headerAction(rule),
    condition: {
      ...scopeCondition(rule.scope),
      ...(rule.initiators.length === 0
        ? {}
        : { initiatorDomains: [...rule.initiators] }),
      resourceTypes: expandResourceTypes(rule.resourceTypes),
    },
  }));
}

export function compileSession(
  overrides: readonly TabOverride[],
  paused: boolean,
): DnrRule[] {
  if (overrides.length > MAX_SESSION_OVERRIDES) {
    throw new RangeError(
      `Cannot compile ${overrides.length} session rules; the limit is ${MAX_SESSION_OVERRIDES}`,
    );
  }
  if (paused) {
    return [];
  }

  return overrides.map((override, index) => ({
    id: override.num,
    priority: SESSION_PRIORITY_TOP - index,
    action: headerAction(override),
    condition: {
      tabIds: [override.tabId],
      requestDomains: [override.originHost],
      resourceTypes: expandResourceTypes("all"),
    },
  }));
}

function headerAction(
  rule: Pick<Rule, "direction" | "header" | "operation" | "value">,
): DnrRuleAction {
  const modification: DnrHeaderModification = {
    header: rule.header,
    operation: rule.operation,
    ...(rule.value === undefined ? {} : { value: rule.value }),
  };

  return rule.direction === "request"
    ? { type: "modifyHeaders", requestHeaders: [modification] }
    : { type: "modifyHeaders", responseHeaders: [modification] };
}
