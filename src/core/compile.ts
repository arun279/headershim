import { type GrantSnapshot, missingGrants, originGranted } from "./grants";
import {
  allowsRequestAppend,
  HTTP_TOKEN,
  normalizeHeaderName,
} from "./headers";
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

/**
 * The compiler's view of the stored doc: only the rules that will actually be
 * applied. Two things keep a rule out, and both have to be settled here.
 *
 * A rule Chrome rejects takes the whole atomic batch down with it, and an
 * untrusted writer can seed one: an import preserves each rule's enabled flag
 * and scope verbatim, and the profile command activates a stored profile
 * without passing the commit guard. Dropping it first means one bad rule cannot
 * freeze the live ruleset.
 *
 * A rule whose origins are not granted has to be absent too, because host
 * access is not fixed: invoking the action, by click or by the extension's
 * keyboard command, hands over activeTab, which is a real host grant for that
 * tab, and declarativeNetRequestWithHostAccess applies any installed rule that
 * matches it. Leaving an ungranted rule installed puts it one gesture away from
 * sending the header the user refused. Keeping it out is what makes "needs
 * access" a state the product enforces rather than a label it prints.
 *
 * A domains rule runs on each of its domains independently, so a partial grant
 * narrows it to the granted domains rather than dropping it whole: revoking one
 * site cannot silence the rule on the sites still granted. Every other scope
 * names no per-host list to narrow, so it stays all-or-nothing.
 *
 * The stored doc is untouched; only the compiler's view of it is filtered.
 * Regex validity needs the browser's RE2 (async), so the caller resolves it
 * into `isRegexSupported`.
 */
export function dropInapplicable(
  state: StateDoc,
  isRegexSupported: (regex: string) => boolean,
  granted: GrantSnapshot,
): StateDoc {
  return {
    ...state,
    profiles: state.profiles.map((profile) =>
      profile.id === state.activeProfileId
        ? {
            ...profile,
            rules: profile.rules.flatMap((rule) => {
              if (!rule.enabled) {
                return [rule];
              }
              const narrowed = narrowToGranted(rule, granted);
              return uncompilableReason(narrowed, isRegexSupported) ===
                undefined && missingGrants(narrowed, granted).length === 0
                ? [narrowed]
                : [];
            }),
          }
        : profile,
    ),
  };
}

// Drop a domains rule's ungranted domains, leaving the granted ones to compile.
// An emptied list falls to uncompilableReason (Chrome refuses an empty one), so
// a rule with no granted domain still leaves the ruleset. Only domains scope
// carries such a list; the rest have nothing to narrow.
function narrowToGranted(rule: Rule, granted: GrantSnapshot): Rule {
  if (rule.scope.type !== "domains") {
    return rule;
  }
  return {
    ...rule,
    scope: {
      ...rule.scope,
      domains: rule.scope.domains.filter((domain) =>
        originGranted(domain, granted),
      ),
    },
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
    !allowsRequestAppend(header)
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
