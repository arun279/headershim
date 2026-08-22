import {
  coversSubresourceTypes,
  dropCoveredNarrowings,
  type GrantNarrowing,
  type GrantSnapshot,
  grantNarrowings,
  missingGrants,
  originCovered,
  originGranted,
} from "./grants";
import {
  allowsRequestAppend,
  HTTP_TOKEN,
  isValidHeaderValue,
  normalizeHeaderName,
} from "./headers";
import {
  MAX_DYNAMIC_RULES,
  MAX_REGEX_RULES,
  MAX_SESSION_OVERRIDES,
} from "./limits";
import type { HeaderOp, Rule, StateDoc, TabOverride } from "./model";
import {
  type DnrResourceType,
  expandResourceTypes,
  hostUnder,
  isDomainSupported,
  isRegexFilterSupported,
  originHost,
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

export { revisionOf } from "./revision";

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
  readonly isUrlFilterCaseSensitive?: boolean;
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
  readonly isUrlFilterCaseSensitive?: boolean;
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
  const bySource = new Map<number, Rule[]>();
  for (const { sourceIndex, rule } of collectApplicableRules(
    state,
    granted,
    isRegexSupported,
  )) {
    const rules = bySource.get(sourceIndex);
    if (rules === undefined) {
      bySource.set(sourceIndex, [rule]);
    } else {
      rules.push(rule);
    }
  }
  return {
    ...state,
    profiles: state.profiles.map((profile) =>
      profile.id === state.activeProfileId
        ? {
            ...profile,
            rules: profile.rules.flatMap((rule, index) =>
              rule.enabled ? (bySource.get(index) ?? []) : [rule],
            ),
          }
        : profile,
    ),
  };
}

interface NarrowedRule {
  readonly rule: Rule;
  /** The target is constrained to a narrowed grant by the condition. */
  readonly targetSecured: boolean;
}

interface GrantCandidate extends GrantNarrowing {
  readonly fullyGranted: boolean;
}

interface ApplicableNarrowing {
  readonly narrowed: NarrowedRule;
  readonly sourceIndex: number;
}

// Narrow every scope that carries requestDomains. Pattern and regex scopes keep
// their authored matcher and lose only ungranted hosts. A domains scope with no
// fully covered host can still run under Chrome's observed toolbar grant: turn
// that granted origin into a request-domain or URL-anchored pattern.
function narrowToGranted(
  rule: Rule,
  granted: GrantSnapshot,
): readonly NarrowedRule[] {
  if (
    rule.scope.type === "all" ||
    ((rule.scope.type === "pattern" || rule.scope.type === "regex") &&
      rule.scope.hosts.length === 0)
  ) {
    return granted.allSites ? [{ rule, targetSecured: false }] : [];
  }
  const hosts =
    rule.scope.type === "domains" ? rule.scope.domains : rule.scope.hosts;
  const fullyGranted = hosts.filter((host) => originGranted(host, granted));
  if (rule.scope.type !== "domains") {
    return fullyGranted.length === 0
      ? []
      : [
          {
            rule: { ...rule, scope: { ...rule.scope, hosts: fullyGranted } },
            targetSecured: false,
          },
        ];
  }
  const fullyGrantedSet = new Set(fullyGranted);
  // Overlapping candidates are dropped because append rules would apply twice.
  const survivors = dropCoveredNarrowings<GrantCandidate>([
    ...fullyGranted.map((host) => ({ host, fullyGranted: true })),
    ...rule.scope.domains.flatMap((domain) =>
      fullyGrantedSet.has(domain)
        ? []
        : grantNarrowings(domain, granted).map((narrowing) => ({
            ...narrowing,
            fullyGranted: false,
          })),
    ),
  ]);
  const fullHosts = survivors
    .filter((candidate) => candidate.fullyGranted)
    .map((candidate) => candidate.host);
  const narrowed: NarrowedRule[] =
    fullHosts.length === 0
      ? []
      : [
          {
            rule: { ...rule, scope: { ...rule.scope, domains: fullHosts } },
            targetSecured: false,
          },
        ];
  for (const narrowing of survivors) {
    if (!narrowing.fullyGranted) {
      narrowed.push({
        rule: {
          ...rule,
          scope:
            narrowing.urlFilter === undefined
              ? { type: "domains", domains: [narrowing.host] }
              : {
                  type: "pattern",
                  pattern: narrowing.urlFilter,
                  hosts: [narrowing.host],
                },
        },
        targetSecured: true,
      });
    }
  }
  return narrowed;
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
    initiatorsGranted(narrowed.rule, granted)
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
  // and a Chrome-valid value. Kept to the shared grammar primitives (not the
  // full validateHeader) so this stays lean in the background bundle.
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
    !isValidHeaderValue(rule.value)
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

interface DynamicCandidate {
  readonly sourceIndex: number;
  readonly narrowed: boolean;
  readonly rule: Rule;
}

interface SessionCandidate {
  readonly override: TabOverride;
  readonly sourceIndex: number;
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

interface CompiledInput {
  readonly dynamicBand: DynamicBand;
  readonly sessionBand: SessionBand;
}

export function compile(input: CompileInput): Batch {
  const { doc, granted, isRegexSupported } = input;
  const { dynamicBand, sessionBand } = compileInput(input);
  const dynamic = doc.settings.paused ? [] : dynamicBand.rules;
  const session = doc.settings.paused ? [] : sessionBand.rules;
  const dynamicPlacements: Placement[][] = [];
  for (let index = 0; index < dynamicBand.rules.length; index += 1) {
    const rule = dynamicBand.rules[index];
    const candidate = dynamicBand.candidates[index];
    if (rule !== undefined && candidate !== undefined) {
      pushPlacement(dynamicPlacements, candidate.sourceIndex, {
        dnrId: rule.id,
        band: "dynamic",
        priority: rule.priority,
        condition: copyCondition(rule.condition),
        narrowed: candidate.narrowed,
        tabId: undefined,
      });
    }
  }
  const sessionPlacements: Placement[][] = [];
  for (let index = 0; index < sessionBand.rules.length; index += 1) {
    const rule = sessionBand.rules[index];
    const candidate = sessionBand.candidates[index];
    if (rule !== undefined && candidate !== undefined) {
      pushPlacement(sessionPlacements, candidate.sourceIndex, {
        dnrId: rule.id,
        band: "session",
        priority: rule.priority,
        condition: copyCondition(rule.condition),
        narrowed: false,
        tabId: candidate.override.tabId,
      });
    }
  }
  const keyedOverrides = keyOverrides(input.overrides);
  const entries = [
    ...doc.profiles.flatMap((profile) => {
      return keyRules(profile.id, profile.rules).map(({ key, rule }, index) =>
        storedEntry(
          key,
          profile.id,
          profile.name,
          doc.activeProfileId,
          rule,
          granted,
          isRegexSupported,
          profile.id === doc.activeProfileId
            ? (dynamicPlacements[index] ?? [])
            : [],
          profile.id === doc.activeProfileId
            ? dynamicBand.limits[index]
            : undefined,
        ),
      );
    }),
    ...keyedOverrides.map(({ key, override }, index) =>
      overrideEntry(
        key,
        doc.activeProfileId,
        override,
        sessionPlacements[index] ?? [],
        sessionBand.limits[index] === true,
      ),
    ),
  ];
  return {
    paused: doc.settings.paused,
    dynamic,
    session,
    entries,
    slots: collectSlots(entries),
  };
}

export function emitRules(input: CompileInput): {
  readonly dynamic: DnrRule[];
  readonly session: DnrRule[];
} {
  if (input.doc.settings.paused) {
    return { dynamic: [], session: [] };
  }
  return {
    dynamic: emitDynamicRules(
      eligibleDynamicRules(
        collectApplicableRules(
          input.doc,
          input.granted,
          input.isRegexSupported,
        ).map((candidate) => candidate.rule),
      ),
    ),
    session: emitSessionRules(
      collectSessionOverrides(input.overrides, input.granted).slice(
        0,
        MAX_SESSION_OVERRIDES,
      ),
    ),
  };
}

function compileInput(input: CompileInput): CompiledInput {
  const dynamicCandidates = collectApplicableRules(
    input.doc,
    input.granted,
    input.isRegexSupported,
  );
  const sessionCandidates = collectSessionOverrides(
    input.overrides,
    input.granted,
  );
  return {
    dynamicBand: compileDynamicBand(dynamicCandidates),
    sessionBand: compileSessionBand(sessionCandidates),
  };
}

export function compileDynamic(state: StateDoc): DnrRule[] {
  return state.settings.paused
    ? []
    : emitDynamicRules(
        eligibleDynamicRules(
          state.profiles
            .find((profile) => profile.id === state.activeProfileId)
            ?.rules.filter((rule) => rule.enabled) ?? [],
        ),
      );
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
  return paused
    ? []
    : emitSessionRules(
        collectSessionOverrides(overrides, granted).slice(
          0,
          MAX_SESSION_OVERRIDES,
        ),
      );
}

interface DynamicBand {
  readonly candidates: DynamicCandidate[];
  readonly rules: DnrRule[];
  readonly limits: readonly ("dynamic" | "regex" | undefined)[];
}

function compileDynamicBand(
  candidates: readonly DynamicCandidate[],
): DynamicBand {
  const eligibleRules = eligibleDynamicRules(
    candidates.map((candidate) => candidate.rule),
  );
  const eligible: DynamicCandidate[] = [];
  const limits: ("dynamic" | "regex" | undefined)[] = [];
  let eligibleIndex = 0;
  let regexCount = 0;
  for (const candidate of candidates) {
    if (candidate.rule === eligibleRules[eligibleIndex]) {
      eligible.push(candidate);
      eligibleIndex += 1;
      if (candidate.rule.scope.type === "regex") {
        regexCount += 1;
      }
    } else {
      limits[candidate.sourceIndex] =
        candidate.rule.scope.type === "regex" && regexCount === MAX_REGEX_RULES
          ? "regex"
          : "dynamic";
    }
  }
  return {
    candidates: eligible,
    rules: emitDynamicRules(eligible.map((candidate) => candidate.rule)),
    limits,
  };
}

function eligibleDynamicRules(rules: readonly Rule[]): Rule[] {
  let regexCount = 0;
  return rules
    .filter(
      (rule) => rule.scope.type !== "regex" || regexCount++ < MAX_REGEX_RULES,
    )
    .slice(0, MAX_DYNAMIC_RULES);
}

function emitDynamicRules(rules: readonly Rule[]): DnrRule[] {
  return rules.map((rule, index) => ({
    id: rule.num,
    priority: DYNAMIC_PRIORITY_TOP - index,
    action: headerAction(rule),
    condition: compileRuleCondition(rule),
  }));
}

function collectApplicableRules(
  state: StateDoc,
  granted: GrantSnapshot,
  isRegexSupported: (regex: string) => boolean,
): DynamicCandidate[] {
  const candidates: DynamicCandidate[] = [];
  let nextSyntheticNum = state.nextRuleNum;
  state.profiles
    .find((profile) => profile.id === state.activeProfileId)
    ?.rules.forEach((rule, sourceIndex) => {
      if (!rule.enabled) {
        return;
      }
      for (const {
        narrowed,
        sourceIndex: projectionIndex,
      } of applicableNarrowings(rule, granted, isRegexSupported)) {
        const compiledRule =
          projectionIndex === 0
            ? narrowed.rule
            : { ...narrowed.rule, num: nextSyntheticNum++ };
        candidates.push({
          sourceIndex,
          narrowed: narrowed.targetSecured,
          rule: compiledRule,
        });
      }
    });
  return candidates;
}

function collectSessionOverrides(
  overrides: readonly TabOverride[],
  granted: GrantSnapshot,
): SessionCandidate[] {
  return overrides.flatMap((override, sourceIndex) =>
    override.enabled && originCovered(override.origin, granted)
      ? [{ override, sourceIndex }]
      : [],
  );
}

interface SessionBand {
  readonly candidates: SessionCandidate[];
  readonly rules: DnrRule[];
  readonly limits: readonly (true | undefined)[];
}

function compileSessionBand(
  candidates: readonly SessionCandidate[],
): SessionBand {
  const eligible = candidates.slice(0, MAX_SESSION_OVERRIDES);
  const limits: (true | undefined)[] = [];
  for (const candidate of candidates.slice(MAX_SESSION_OVERRIDES)) {
    limits[candidate.sourceIndex] = true;
  }
  return {
    candidates: eligible,
    rules: emitSessionRules(eligible),
    limits,
  };
}

function emitSessionRules(candidates: readonly SessionCandidate[]): DnrRule[] {
  return candidates.map(({ override }, index) => ({
    id: override.num,
    priority: SESSION_PRIORITY_TOP - index,
    action: headerAction(override),
    condition: overrideCondition(override),
  }));
}

function overrideCondition(override: TabOverride): DnrRuleCondition {
  return {
    tabIds: [override.tabId],
    requestDomains: [originHost(override.origin)],
    urlFilter: `|${override.origin}/`,
    resourceTypes: expandResourceTypes("all"),
  };
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
    ...(condition.tabIds === undefined
      ? {}
      : { tabIds: [...condition.tabIds] }),
  };
}

function pushPlacement(
  placements: Placement[][],
  sourceIndex: number,
  placement: Placement,
): void {
  const existing = placements[sourceIndex];
  if (existing === undefined) {
    placements[sourceIndex] = [placement];
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
    grantGap:
      rule.enabled && profileId === activeProfileId && placements.length > 0
        ? grantGap(rule, granted, placements)
        : undefined,
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
  return (
    grantGap(rule, granted) ?? {
      kind: "refused",
      reason: "domains",
    }
  );
}

function grantGap(
  rule: Rule,
  granted: GrantSnapshot,
  placements: readonly Placement[] = [],
): AbsentReason | undefined {
  const missingInitiators = coversSubresourceTypes(rule)
    ? rule.initiators
        .filter((initiator) => !originGranted(initiator, granted))
        .map(originPatternForDomain)
    : [];
  const targetReached = narrowToGranted(rule, granted).length > 0;
  const initiatorReason = missingReason(
    "ungranted-initiator",
    missingInitiators,
  );
  if (targetReached && initiatorReason !== undefined) {
    return initiatorReason;
  }
  const placedDomains = placements.flatMap((placement) =>
    placement.condition.urlFilter === undefined
      ? (placement.condition.requestDomains ?? [])
      : [],
  );
  const missing =
    rule.scope.type === "domains"
      ? rule.scope.domains
          .filter(
            (domain) =>
              !placedDomains.some((placed) => hostUnder(domain, placed)),
          )
          .map(originPatternForDomain)
      : missingGrants(rule, granted);
  return missingReason("ungranted", missing);
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
                  missing: [
                    originPatternForDomain(originHost(override.origin)),
                  ],
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
    grantGap: undefined,
  };
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
