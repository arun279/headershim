import { classifyHeaderName, HTTP_TOKEN, normalizeHeaderName } from "./headers";
import {
  MAX_ENABLED_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "./limits";
import type { HeaderOp, Rule, StateDoc, TabOverride } from "./model";
import {
  type DnrResourceType,
  expandResourceTypes,
  isDomainSupported,
  isRegexFilterSupported,
  scopeCondition,
  validateUrlFilter,
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

// An untrusted writer can seed the enabled set with a rule Chrome rejects: a
// ModHeader/headershim import preserves each rule's enabled flag and scope
// verbatim (no header/urlFilter/regex grammar check), and the next-profile
// command activates a stored profile without passing the commit guard. compileDynamic
// would emit that rule and updateDynamicRules would reject the whole atomic batch,
// freezing the live ruleset at its last-good revision until the user finds the one
// bad rule. Dropping every uncompilable rule from the compiled input before it
// reaches Chrome makes that impossible — one bad rule can never take the batch
// down, and every other rule keeps applying. The stored doc is untouched; only
// the compiler's view of it is filtered. Regex validity needs the browser's RE2
// (async), so the caller resolves it into `isRegexSupported`.
export function dropUncompilable(
  state: StateDoc,
  isRegexSupported: (regex: string) => boolean,
): StateDoc {
  return {
    ...state,
    profiles: state.profiles.map((profile) =>
      profile.id === state.activeProfileId
        ? {
            ...profile,
            rules: profile.rules.filter(
              (rule) =>
                !rule.enabled ||
                uncompilableReason(rule, isRegexSupported) === undefined,
            ),
          }
        : profile,
    ),
  };
}

export type UncompilableReason =
  | "header"
  | "append"
  | "value"
  | "pattern"
  | "regex"
  | "domains";

/**
 * Why Chrome would refuse this rule, or undefined when it will run it. This is
 * the one answer to "will Chrome run this rule": the compiler drops whatever it
 * names, so any surface that reads the same reason states the same fact the
 * engine acted on, and no line can claim to run a rule that never reached the
 * batch.
 */
export function uncompilableReason(
  rule: Rule,
  isRegexSupported: (regex: string) => boolean,
): UncompilableReason | undefined {
  // The header-shape checks Chrome enforces before it admits a modifyHeaders
  // rule to the atomic batch: a token-grammar name that is not a pseudo-header,
  // and a value with no line break. Kept to the shared grammar primitives (not
  // the full validateHeader) so this stays lean in the background bundle.
  const header = normalizeHeaderName(rule.header);
  if (!HTTP_TOKEN.test(header)) {
    return "header";
  }
  if (
    rule.operation === "append" &&
    rule.direction === "request" &&
    classifyHeaderName(header).requestAppend !== "allowed"
  ) {
    return "append";
  }
  if (
    rule.operation !== "remove" &&
    rule.value !== undefined &&
    /[\r\n]/.test(rule.value)
  ) {
    return "value";
  }
  if (!rule.initiators.every(isDomainSupported)) {
    return "domains";
  }
  if (
    (rule.scope.type === "pattern" || rule.scope.type === "regex") &&
    !rule.scope.hosts.every(isDomainSupported)
  ) {
    return "domains";
  }
  switch (rule.scope.type) {
    case "pattern":
      return validateUrlFilter(rule.scope.pattern).ok ? undefined : "pattern";
    case "regex":
      return isRegexFilterSupported(rule.scope.regex) &&
        isRegexSupported(rule.scope.regex)
        ? undefined
        : "regex";
    case "domains":
      // Chrome refuses an empty requestDomains list outright, and any entry
      // with a non-ASCII character in it.
      return rule.scope.domains.length > 0 &&
        rule.scope.domains.every(isDomainSupported)
        ? undefined
        : "domains";
    case "all":
      return undefined;
  }
}

export function compileDynamic(state: StateDoc): DnrRule[] {
  const enabledRules =
    state.profiles
      .find((profile) => profile.id === state.activeProfileId)
      ?.rules.filter((rule) => rule.enabled) ?? [];
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
    condition: compileRuleCondition(rule),
  }));
}

function compileRuleCondition(rule: Rule): DnrRuleCondition {
  return {
    ...scopeCondition(rule.scope),
    ...(rule.initiators.length === 0
      ? {}
      : { initiatorDomains: [...rule.initiators] }),
    resourceTypes: expandResourceTypes(rule.resourceTypes),
  };
}

export function settlesPerRequest(rule: Rule): boolean {
  const condition = compileRuleCondition(rule);
  return (
    condition.urlFilter !== undefined ||
    condition.regexFilter !== undefined ||
    condition.initiatorDomains !== undefined
  );
}

export function compileSession(
  overrides: readonly TabOverride[],
  paused: boolean,
): DnrRule[] {
  const enabledOverrides = overrides.filter((override) => override.enabled);
  if (enabledOverrides.length > MAX_SESSION_OVERRIDES) {
    throw new RangeError(
      `Cannot compile ${enabledOverrides.length} session rules; the limit is ${MAX_SESSION_OVERRIDES}`,
    );
  }
  if (paused) {
    return [];
  }

  return enabledOverrides.map((override, index) => ({
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
