import {
  coversSubresourceTypes,
  type GrantSnapshot,
  missingGrants,
  narrowedGrantUrlFilter,
  originGranted,
} from "./grants";
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
 * Every host-named scope runs on each requestDomains entry independently, so
 * an incomplete set of grants narrows it to the fully covered hosts rather than
 * dropping it whole. A toolbar-narrowed domains grant is compiled as an exact
 * URL prefix, keeping Chrome's granted scheme/host/port subset live while
 * preventing activeTab from widening the condition.
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
              return uncompilableReason(narrowed.rule, isRegexSupported) ===
                undefined &&
                (narrowed.targetSecured
                  ? initiatorsGranted(narrowed.rule, granted)
                  : missingGrants(narrowed.rule, granted).length === 0)
                ? [narrowed.rule]
                : [];
            }),
          }
        : profile,
    ),
  };
}

interface NarrowedRule {
  readonly rule: Rule;
  /** The target is constrained to an exact narrowed grant by the condition. */
  readonly targetSecured: boolean;
}

// Narrow every scope that carries requestDomains. Pattern and regex scopes keep
// their authored matcher and lose only ungranted hosts. A domains scope with no
// fully covered host can still run under Chrome's observed toolbar grant: turn
// that exact origin into a URL-anchored pattern. If no host survives, retain the
// original requirement so missingGrants drops it instead of accidentally
// turning an empty host list into broad access.
function narrowToGranted(rule: Rule, granted: GrantSnapshot): NarrowedRule {
  if (rule.scope.type === "all") {
    return { rule, targetSecured: false };
  }
  const hosts =
    rule.scope.type === "domains" ? rule.scope.domains : rule.scope.hosts;
  const fullyGranted = hosts.filter((host) => originGranted(host, granted));
  if (fullyGranted.length > 0) {
    return {
      rule: {
        ...rule,
        scope:
          rule.scope.type === "domains"
            ? { ...rule.scope, domains: fullyGranted }
            : { ...rule.scope, hosts: fullyGranted },
      },
      targetSecured: false,
    };
  }
  if (rule.scope.type === "domains") {
    for (const domain of rule.scope.domains) {
      const urlFilter = narrowedGrantUrlFilter(domain, granted);
      if (urlFilter !== undefined) {
        return {
          rule: {
            ...rule,
            scope: {
              type: "pattern",
              pattern: urlFilter,
              hosts: [domain],
            },
          },
          targetSecured: true,
        };
      }
    }
  }
  return { rule, targetSecured: false };
}

function initiatorsGranted(rule: Rule, granted: GrantSnapshot): boolean {
  return (
    !coversSubresourceTypes(rule) ||
    rule.initiators.every((initiator) => originGranted(initiator, granted))
  );
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

/**
 * The reason dropInapplicable gives for stored rules holds for this-tab rows
 * too: invoking the action hands over activeTab, and the engine applies whatever
 * is installed to a host it has access to, so a row whose host is not granted
 * must be absent from the batch rather than merely pruned from storage. Taking
 * the snapshot as a parameter is what makes a grant-blind compile a build error.
 * A row carries exactly one host, so there is nothing to narrow: it compiles or
 * it is absent.
 */
export function compileSession(
  overrides: readonly TabOverride[],
  paused: boolean,
  granted: GrantSnapshot,
): DnrRule[] {
  const enabledOverrides = overrides.flatMap<{
    readonly override: TabOverride;
    readonly urlFilter: string | undefined;
  }>((override) => {
    if (!override.enabled) {
      return [];
    }
    if (originGranted(override.originHost, granted)) {
      return [{ override, urlFilter: undefined }];
    }
    const urlFilter = narrowedGrantUrlFilter(override.originHost, granted);
    return urlFilter === undefined ? [] : [{ override, urlFilter }];
  });
  if (enabledOverrides.length > MAX_SESSION_OVERRIDES) {
    throw new RangeError(
      `Cannot compile ${enabledOverrides.length} session rules; the limit is ${MAX_SESSION_OVERRIDES}`,
    );
  }
  if (paused) {
    return [];
  }

  return enabledOverrides.map(({ override, urlFilter }, index) => ({
    id: override.num,
    priority: SESSION_PRIORITY_TOP - index,
    action: headerAction(override),
    condition: {
      tabIds: [override.tabId],
      requestDomains: [override.originHost],
      ...(urlFilter === undefined ? {} : { urlFilter }),
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
