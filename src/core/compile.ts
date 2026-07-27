import {
  coversSubresourceTypes,
  type GrantSnapshot,
  missingGrants,
  narrowedGrantUrlFilters,
  originGranted,
} from "./grants";
import {
  allowsRequestAppend,
  HTTP_TOKEN,
  normalizeHeaderName,
} from "./headers";
import {
  MAX_DYNAMIC_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "./limits";
import type { HeaderOp, Rule, StateDoc, TabOverride } from "./model";
import { normalize } from "./reconcile";
import {
  type DnrResourceType,
  expandResourceTypes,
  isDomainSupported,
  isRegexFilterSupported,
  originPatternForDomain,
  scopeCondition,
  validateUrlFilter,
} from "./scope";
import {
  type AbsentReason,
  type Batch,
  type Entry,
  overrideKey,
  type PlacedRef,
  type Placement,
  type RuleKey,
  ruleKey,
  type Standing,
  type UncompilableReason,
} from "./verdict";

export type { UncompilableReason } from "./verdict";

export const DYNAMIC_PRIORITY_TOP = 5_000;
export const SESSION_PRIORITY_TOP = 10_000;

interface DnrHeaderModification {
  readonly header: string;
  readonly operation: HeaderOp;
  readonly value?: string;
}

interface DnrRuleAction {
  readonly type: "modifyHeaders";
  readonly requestHeaders?: DnrHeaderModification[];
  readonly responseHeaders?: DnrHeaderModification[];
}

interface DnrRuleCondition {
  readonly requestDomains?: string[];
  readonly initiatorDomains?: string[];
  readonly urlFilter?: string;
  readonly regexFilter?: string;
  readonly resourceTypes?: DnrResourceType[];
  readonly tabIds?: number[];
}

export interface DnrRule {
  readonly id: number;
  readonly priority: number;
  readonly action: DnrRuleAction;
  readonly condition: DnrRuleCondition;
}

export interface ReadonlyDnrRuleCondition {
  readonly requestDomains?: readonly string[];
  readonly initiatorDomains?: readonly string[];
  readonly urlFilter?: string;
  readonly regexFilter?: string;
  readonly resourceTypes?: readonly DnrResourceType[];
  readonly tabIds?: readonly number[];
}

interface ReadonlyDnrRuleAction {
  readonly type: "modifyHeaders";
  readonly requestHeaders?: readonly DnrHeaderModification[];
  readonly responseHeaders?: readonly DnrHeaderModification[];
}

export interface ReadonlyDnrRule {
  readonly id: number;
  readonly priority: number;
  readonly action: ReadonlyDnrRuleAction;
  readonly condition: ReadonlyDnrRuleCondition;
}

export interface CompileInput {
  readonly doc: StateDoc;
  readonly overrides: readonly TabOverride[];
  readonly granted: GrantSnapshot;
  readonly isRegexSupported: (regex: string) => boolean;
}

export function installedRevisionOf(
  dynamic: readonly DnrRule[],
  session: readonly DnrRule[],
): string {
  const text = [
    ...normalize([...dynamic]).map((rule) => `dynamic:${JSON.stringify(rule)}`),
    ...normalize([...session]).map((rule) => `session:${JSON.stringify(rule)}`),
  ]
    .sort()
    .join("\n");
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}:${bytes.length}:${dynamic.length + session.length}`;
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
  let nextSyntheticNum = state.nextRuleNum;
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
              return applicableNarrowings(rule, granted, isRegexSupported).map(
                ({ narrowed, sourceIndex }) =>
                  sourceIndex === 0
                    ? narrowed.rule
                    : { ...narrowed.rule, num: nextSyntheticNum++ },
              );
            }),
          }
        : profile,
    ),
    // Synthetic variants exist only in this compiler view. Advancing its
    // allocator guarantees their DNR numeric ids cannot collide with authored
    // rules; the shared authored id deliberately keeps projections attached to
    // the one stored rule they represent.
    nextRuleNum: nextSyntheticNum,
  };
}

interface NarrowedRule {
  readonly rule: Rule;
  /** The target is constrained to an exact narrowed grant by the condition. */
  readonly targetSecured: boolean;
}

interface ApplicableNarrowing {
  readonly narrowed: NarrowedRule;
  readonly sourceIndex: number;
}

// Narrow every scope that carries requestDomains. Pattern and regex scopes keep
// their authored matcher and lose only ungranted hosts. A domains scope with no
// fully covered host can still run under Chrome's observed toolbar grant: turn
// that exact origin into a URL-anchored pattern. If no host survives, retain the
// original requirement so missingGrants drops it instead of accidentally
// turning an empty host list into broad access.
function narrowToGranted(
  rule: Rule,
  granted: GrantSnapshot,
): readonly NarrowedRule[] {
  if (rule.scope.type === "all") {
    return [{ rule, targetSecured: false }];
  }
  const hosts =
    rule.scope.type === "domains" ? rule.scope.domains : rule.scope.hosts;
  const fullyGranted = hosts.filter((host) => originGranted(host, granted));
  const fullyGrantedSet = new Set(fullyGranted);
  const narrowed: NarrowedRule[] =
    fullyGranted.length === 0
      ? []
      : [
          {
            rule: {
              ...rule,
              scope:
                rule.scope.type === "domains"
                  ? { ...rule.scope, domains: fullyGranted }
                  : { ...rule.scope, hosts: fullyGranted },
            },
            targetSecured: false,
          },
        ];
  if (rule.scope.type === "domains") {
    const seenFilters = new Set<string>();
    for (const domain of rule.scope.domains) {
      // A full grant already admits every concrete subset for this domain.
      // Emitting both would apply append rules twice on the narrower origin.
      if (fullyGrantedSet.has(domain)) {
        continue;
      }
      for (const urlFilter of narrowedGrantUrlFilters(domain, granted)) {
        if (!seenFilters.has(urlFilter)) {
          seenFilters.add(urlFilter);
          narrowed.push({
            rule: {
              ...rule,
              scope: {
                type: "pattern",
                pattern: urlFilter,
                hosts: [domain],
              },
            },
            targetSecured: true,
          });
        }
      }
    }
  }
  return narrowed.length === 0 ? [{ rule, targetSecured: false }] : narrowed;
}

function initiatorsGranted(rule: Rule, granted: GrantSnapshot): boolean {
  return (
    !coversSubresourceTypes(rule) ||
    rule.initiators.every((initiator) => originGranted(initiator, granted))
  );
}

function applicableNarrowings(
  rule: Rule,
  granted: GrantSnapshot,
  isRegexSupported: (regex: string) => boolean,
): ApplicableNarrowing[] {
  return narrowToGranted(rule, granted).flatMap((narrowed, sourceIndex) =>
    uncompilableReason(narrowed.rule, isRegexSupported) === undefined &&
    (narrowed.targetSecured
      ? initiatorsGranted(narrowed.rule, granted)
      : missingGrants(narrowed.rule, granted).length === 0)
      ? [{ narrowed, sourceIndex }]
      : [],
  );
}

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

interface DynamicCandidate {
  readonly key: RuleKey;
  readonly narrowed: boolean;
  readonly rule: Rule;
}

interface SessionNarrowing {
  readonly override: TabOverride;
  readonly urlFilter: string | undefined;
}

interface SessionCandidate extends SessionNarrowing {
  readonly key: RuleKey;
}

interface KeyedRule {
  readonly key: RuleKey;
  readonly rule: Rule;
}

interface KeyedOverride {
  readonly key: RuleKey;
  readonly override: TabOverride;
}

function keyRules(profileId: string, rules: readonly Rule[]): KeyedRule[] {
  const occurrences = new Map<string, number>();
  return rules.map((rule) => {
    const occurrence = occurrences.get(rule.id) ?? 0;
    occurrences.set(rule.id, occurrence + 1);
    return { key: ruleKey(profileId, rule.id, occurrence), rule };
  });
}

function keyOverrides(overrides: readonly TabOverride[]): KeyedOverride[] {
  const occurrences = new Map<number, number>();
  return overrides.map((override) => {
    const occurrence = occurrences.get(override.num) ?? 0;
    occurrences.set(override.num, occurrence + 1);
    return { key: overrideKey(override.num, occurrence), override };
  });
}

export function compile(input: CompileInput): Batch {
  const { doc, granted, isRegexSupported, overrides } = input;
  const dynamicCandidates = collectDynamicCandidates(
    doc,
    granted,
    isRegexSupported,
  );
  const dynamicLimits = new Map<RuleKey, "dynamic" | "regex">();
  const dynamicOverflow = dynamicCandidates.length > MAX_DYNAMIC_RULES;
  const regexOverflow =
    dynamicCandidates.filter(
      (candidate) => candidate.rule.scope.type === "regex",
    ).length > MAX_REGEX_RULES;
  const eligibleDynamic = dynamicCandidates.filter((candidate) => {
    if (dynamicOverflow) {
      dynamicLimits.set(candidate.key, "dynamic");
      return false;
    }
    if (regexOverflow && candidate.rule.scope.type === "regex") {
      dynamicLimits.set(candidate.key, "regex");
      return false;
    }
    return true;
  });
  const compiledDynamic = eligibleDynamic.map((candidate, index) => ({
    id: candidate.rule.num,
    priority: DYNAMIC_PRIORITY_TOP - index,
    action: headerAction(candidate.rule),
    condition: compileRuleCondition(candidate.rule),
  }));

  const keyedOverrides = keyOverrides(overrides);
  const sessionCandidates = collectSessionCandidates(keyedOverrides, granted);
  const sessionOverflow = sessionCandidates.length > MAX_SESSION_OVERRIDES;
  const compiledSession = sessionOverflow
    ? []
    : compileSessionCandidates(sessionCandidates, overrides);
  const placements = collectPlacements(
    eligibleDynamic,
    compiledDynamic,
    sessionOverflow ? [] : sessionCandidates,
    compiledSession,
  );
  const entries = [
    ...doc.profiles.flatMap((profile) => {
      return keyRules(profile.id, profile.rules).map(({ key, rule }) =>
        storedEntry(
          key,
          profile.id,
          profile.name,
          doc.activeProfileId,
          rule,
          granted,
          isRegexSupported,
          placements.get(key) ?? [],
          dynamicLimits.get(key),
        ),
      );
    }),
    ...keyedOverrides.map(({ key, override }) =>
      overrideEntry(
        key,
        doc.activeProfileId,
        override,
        placements.get(key) ?? [],
        sessionOverflow,
      ),
    ),
  ];
  const dynamic = doc.settings.paused ? [] : compiledDynamic;
  const session = doc.settings.paused ? [] : compiledSession;
  return {
    installedRevision: installedRevisionOf(dynamic, session),
    paused: doc.settings.paused,
    dynamic,
    session,
    entries,
    slots: collectSlots(entries),
  };
}

export function compileDynamic(state: StateDoc): DnrRule[] {
  const enabledRules =
    state.profiles
      .find((profile) => profile.id === state.activeProfileId)
      ?.rules.filter((rule) => rule.enabled) ?? [];
  if (enabledRules.length > MAX_DYNAMIC_RULES) {
    throw new RangeError(
      `Dynamic rules: ${enabledRules.length}/${MAX_DYNAMIC_RULES}`,
    );
  }
  const regexCount = enabledRules.filter(
    (rule) => rule.scope.type === "regex",
  ).length;
  if (regexCount > MAX_REGEX_RULES) {
    throw new RangeError(`Regex rules: ${regexCount}/${MAX_REGEX_RULES}`);
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

/**
 * An ungranted this-tab row must stay out of the installed batch. Invoking the
 * action provides activeTab, which would otherwise make that row take effect.
 */
export function compileSession(
  overrides: readonly TabOverride[],
  paused: boolean,
  granted: GrantSnapshot,
): DnrRule[] {
  const candidates = overrides.flatMap((override) =>
    narrowOverride(override, granted),
  );
  if (candidates.length > MAX_SESSION_OVERRIDES) {
    throw new RangeError(
      `Session rules: ${candidates.length}/${MAX_SESSION_OVERRIDES}`,
    );
  }
  return paused ? [] : compileSessionCandidates(candidates, overrides);
}

function collectDynamicCandidates(
  doc: StateDoc,
  granted: GrantSnapshot,
  isRegexSupported: (regex: string) => boolean,
): DynamicCandidate[] {
  const profile = doc.profiles.find(
    (candidate) => candidate.id === doc.activeProfileId,
  );
  if (profile === undefined) {
    return [];
  }
  let nextSyntheticNum = doc.nextRuleNum;
  return keyRules(profile.id, profile.rules).flatMap(({ key, rule }) => {
    if (!rule.enabled) {
      return [];
    }
    return applicableNarrowings(rule, granted, isRegexSupported).map(
      ({ narrowed, sourceIndex }) => ({
        key,
        narrowed: narrowed.targetSecured,
        rule:
          sourceIndex === 0
            ? narrowed.rule
            : { ...narrowed.rule, num: nextSyntheticNum++ },
      }),
    );
  });
}

function collectSessionCandidates(
  overrides: readonly KeyedOverride[],
  granted: GrantSnapshot,
): SessionCandidate[] {
  return overrides.flatMap<SessionCandidate>(({ key, override }) =>
    narrowOverride(override, granted).map((candidate) => ({
      key,
      ...candidate,
    })),
  );
}

function narrowOverride(
  override: TabOverride,
  granted: GrantSnapshot,
): SessionNarrowing[] {
  if (!override.enabled) {
    return [];
  }
  if (originGranted(override.originHost, granted)) {
    return [{ override, urlFilter: undefined }];
  }
  return narrowedGrantUrlFilters(override.originHost, granted).map(
    (urlFilter) => ({ override, urlFilter }),
  );
}

function compileSessionCandidates(
  candidates: readonly SessionNarrowing[],
  overrides: readonly TabOverride[],
): DnrRule[] {
  let nextSyntheticNum =
    overrides.reduce((max, override) => Math.max(max, override.num), 0) + 1;
  const seenOverrideNums = new Set<number>();
  return candidates.map(({ override, urlFilter }, index) => {
    const id = seenOverrideNums.has(override.num)
      ? nextSyntheticNum++
      : override.num;
    seenOverrideNums.add(override.num);
    return {
      id,
      priority: SESSION_PRIORITY_TOP - index,
      action: headerAction(override),
      condition: overrideCondition(override, urlFilter),
    };
  });
}

function overrideCondition(
  override: TabOverride,
  urlFilter?: string,
): DnrRuleCondition {
  return {
    tabIds: [override.tabId],
    requestDomains: [override.originHost],
    ...(urlFilter === undefined ? {} : { urlFilter }),
    resourceTypes: expandResourceTypes("all"),
  };
}

function collectPlacements(
  dynamicCandidates: readonly DynamicCandidate[],
  dynamic: readonly DnrRule[],
  sessionCandidates: readonly SessionCandidate[],
  session: readonly DnrRule[],
): Map<RuleKey, Placement[]> {
  const placements = new Map<RuleKey, Placement[]>();
  dynamic.forEach((rule, index) => {
    const candidate = dynamicCandidates[index];
    if (candidate !== undefined) {
      pushPlacement(placements, candidate.key, {
        dnrId: rule.id,
        band: "dynamic",
        priority: rule.priority,
        condition: copyCondition(rule.condition),
        narrowed: candidate.narrowed,
        tabId: undefined,
      });
    }
  });
  session.forEach((rule, index) => {
    const candidate = sessionCandidates[index];
    if (candidate !== undefined) {
      pushPlacement(placements, candidate.key, {
        dnrId: rule.id,
        band: "session",
        priority: rule.priority,
        condition: copyCondition(rule.condition),
        narrowed: candidate.urlFilter !== undefined,
        tabId: candidate.override.tabId,
      });
    }
  });
  return placements;
}

function copyCondition(condition: DnrRuleCondition): ReadonlyDnrRuleCondition {
  return {
    ...condition,
    ...(condition.requestDomains === undefined
      ? {}
      : { requestDomains: [...condition.requestDomains] }),
    ...(condition.initiatorDomains === undefined
      ? {}
      : { initiatorDomains: [...condition.initiatorDomains] }),
    ...(condition.resourceTypes === undefined
      ? {}
      : { resourceTypes: [...condition.resourceTypes] }),
    ...(condition.tabIds === undefined
      ? {}
      : { tabIds: [...condition.tabIds] }),
  };
}

function pushPlacement(
  placements: Map<RuleKey, Placement[]>,
  key: RuleKey,
  placement: Placement,
): void {
  const existing = placements.get(key);
  if (existing === undefined) {
    placements.set(key, [placement]);
  } else {
    existing.push(placement);
  }
}

function storedEntry(
  key: RuleKey,
  profileId: string,
  profileName: string,
  activeProfileId: string,
  rule: Rule,
  granted: GrantSnapshot,
  isRegexSupported: (regex: string) => boolean,
  placements: readonly Placement[],
  overLimit: "dynamic" | "regex" | undefined,
): Entry {
  return {
    key,
    profileId,
    label: rule.comment?.trim() || `${rule.header} rule`,
    stage: rule.direction,
    headerKey: normalizeHeaderName(rule.header),
    header: rule.header,
    operation: rule.operation,
    authored: compileRuleCondition(rule),
    standing:
      rule.enabled && profileId === activeProfileId
        ? standingForRule(
            rule,
            granted,
            isRegexSupported,
            placements,
            overLimit,
          )
        : {
            kind: "absent",
            reason: rule.enabled
              ? { kind: "other-profile", profileName }
              : { kind: "off" },
          },
    uncoveredSchemes: uncoveredSchemes(rule, granted),
    initiatorUnnamed:
      coversSubresourceTypes(rule) && rule.initiators.length === 0,
  };
}

function standingForRule(
  rule: Rule,
  granted: GrantSnapshot,
  isRegexSupported: (regex: string) => boolean,
  placements: readonly Placement[],
  overLimit: "dynamic" | "regex" | undefined,
): Standing {
  const firstPlacement = placements[0];
  if (firstPlacement !== undefined) {
    return {
      kind: "placed",
      placements: [firstPlacement, ...placements.slice(1)],
    };
  }
  if (overLimit !== undefined) {
    return {
      kind: "absent",
      reason: { kind: "over-limit", limit: overLimit },
    };
  }
  const refusal = uncompilableReason(rule, isRegexSupported);
  if (refusal !== undefined) {
    return { kind: "absent", reason: { kind: "refused", reason: refusal } };
  }
  return {
    kind: "absent",
    reason: ungrantedReason(rule, granted),
  };
}

function ungrantedReason(rule: Rule, granted: GrantSnapshot): AbsentReason {
  const missingInitiators = coversSubresourceTypes(rule)
    ? rule.initiators
        .filter((initiator) => !originGranted(initiator, granted))
        .map(originPatternForDomain)
    : [];
  const targetReached = narrowToGranted(rule, granted).some(
    ({ rule: narrowed, targetSecured }) =>
      targetSecured ||
      missingGrants({ ...narrowed, initiators: [] }, granted).length === 0,
  );
  const initiatorReason = missingReason(
    "ungranted-initiator",
    missingInitiators,
  );
  if (targetReached && initiatorReason !== undefined) {
    return initiatorReason;
  }
  return (
    missingReason("ungranted", missingGrants(rule, granted)) ?? {
      kind: "refused",
      reason: "domains",
    }
  );
}

function missingReason(
  kind: "ungranted" | "ungranted-initiator",
  missing: readonly string[],
): AbsentReason | undefined {
  const [first, ...rest] = missing;
  return first === undefined ? undefined : { kind, missing: [first, ...rest] };
}

function overrideEntry(
  key: RuleKey,
  profileId: string,
  override: TabOverride,
  placements: readonly Placement[],
  overLimit: boolean,
): Entry {
  const firstPlacement = placements[0];
  const standing: Standing =
    firstPlacement !== undefined
      ? {
          kind: "placed",
          placements: [firstPlacement, ...placements.slice(1)],
        }
      : {
          kind: "absent",
          reason: override.enabled
            ? overLimit
              ? { kind: "over-limit", limit: "session" }
              : {
                  kind: "ungranted",
                  missing: [originPatternForDomain(override.originHost)],
                }
            : { kind: "off" },
        };
  return {
    key,
    profileId,
    label: `${override.header} rule`,
    stage: override.direction,
    headerKey: normalizeHeaderName(override.header),
    header: override.header,
    operation: override.operation,
    authored: overrideCondition(override),
    standing,
    uncoveredSchemes: [],
    initiatorUnnamed: false,
  };
}

function uncoveredSchemes(
  rule: Rule,
  granted: GrantSnapshot,
): readonly ("ws" | "wss")[] {
  if (
    !expandResourceTypes(rule.resourceTypes).includes("websocket") ||
    granted.origins.includes("<all_urls>")
  ) {
    return [];
  }
  if (rule.scope.type === "domains" || rule.scope.type === "all") {
    return ["ws", "wss"];
  }
  const matcher =
    rule.scope.type === "pattern" ? rule.scope.pattern : rule.scope.regex;
  const scheme = /^\^?\|?(https?|wss?):(?:\\?\/){2}/.exec(matcher)?.[1];
  return scheme === "http" || scheme === "https"
    ? []
    : scheme === "ws" || scheme === "wss"
      ? [scheme]
      : ["ws", "wss"];
}

function collectSlots(
  entries: readonly Entry[],
): ReadonlyMap<string, readonly PlacedRef[]> {
  const slots = new Map<string, PlacedRef[]>();
  for (const entry of entries) {
    if (entry.standing.kind === "absent") {
      continue;
    }
    for (const placement of entry.standing.placements) {
      const slot = `${entry.stage}:${entry.headerKey}`;
      const placedRef = {
        key: entry.key,
        operation: entry.operation,
        placement,
      };
      const existing = slots.get(slot);
      if (existing === undefined) {
        slots.set(slot, [placedRef]);
      } else {
        existing.push(placedRef);
      }
    }
  }
  for (const placements of slots.values()) {
    placements.sort(
      (left, right) => right.placement.priority - left.placement.priority,
    );
  }
  return slots;
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
