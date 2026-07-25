/**
 * The popup's one question, answered as data: what is HeaderShim doing to the
 * tab in front of you, and how live is each change. A pure projection over the
 * active profile, the active host, the grant snapshot, and this-tab overrides.
 * It computes nothing the engine already computes: the system status comes from
 * core/status, "will Chrome run this" from the compiler's own gate, collisions
 * from core/conflicts. Where Chrome decides inside its own matcher, the line
 * says so rather than guessing, so it never claims a fact it did not compute.
 */

import {
  settlesPerRequest,
  type UncompilableReason,
  uncompilableReason,
} from "../../core/compile";
import type { GrantSnapshot } from "../../core/grants";
import { missingGrants, originGranted } from "../../core/grants";
import { classifyHeaderName, normalizeHeaderName } from "../../core/headers";
import {
  activeProfile,
  type Direction,
  type HeaderOp,
  type Profile,
  type Rule,
  type StateDoc,
  type TabOverride,
} from "../../core/model";
import {
  conditionReaches,
  hostUnder,
  originPatternForDomain,
  scopeCondition,
} from "../../core/scope";
import type { SystemStatus } from "../../core/status";
import {
  headerValueSummary,
  isSecretHeader,
  ruleValueSummary,
} from "../secret";
import { overriddenLabels } from "./overridden";

/** Per-line health, in the same order the severity spine reads it. */
export type LineStatus =
  | "live"
  | "unconfirmed"
  | "needs-access"
  | "refused"
  | "managed"
  | "overridden"
  | "out-of-sync"
  | "off"
  | "paused";

export type RefusedReason = "host" | UncompilableReason;

/**
 * Whether a rule's conditions reach the tab in front of you. `unknown` is a
 * real answer, and the only honest one where Chrome decides per request.
 */
type Reach = "yes" | "no" | "unknown";

/**
 * The description every projected line carries, popup change line and Workbench
 * fleet row alike: what the change does, how live it is, and the one exception
 * it names. Assembled once in `lineCore`, so the two surfaces cannot drift on
 * how a change reads or which of its states they carry; each surface spreads its
 * own identity and reach fields around this core.
 */
export interface LineCore {
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  /** The redacted reading shown on the line; undefined for a remove. */
  readonly display?: string;
  readonly secret: boolean;
  /** The rule's real on/off, kept through pause so the toggle stays honest. */
  readonly enabled: boolean;
  readonly status: LineStatus;
  /** The winning rule's label, when this line lost a same-header collision. */
  readonly overriddenBy?: string;
  /** Why Chrome refuses this line, when its status is refused. */
  readonly refused?: RefusedReason;
  /** Origins to grant, when this line needs access. */
  readonly missing?: readonly string[];
}

export interface TabChange extends LineCore {
  /** Stable key for rendering, focus, and tests. */
  readonly key: string;
  readonly source: "rule" | "override";
  readonly profileId?: string;
  readonly ruleId?: string;
  readonly overrideNum?: number;
  readonly value?: string;
  /**
   * How far this rule reaches past the tab the popup is open on: the number of
   * other domains it names, or "broad" for a scope that names none. Absent when
   * the rule reaches this host and nowhere else, which is when the line's switch
   * has no consequence off this tab.
   */
  readonly widerReach?: number | "broad";
}

export interface TabReadout {
  readonly host: string | undefined;
  /** Every change that reaches this tab, including token and override lines. */
  readonly total: number;
  /** What total would have counted if header changes were not paused. */
  readonly held: number;
  readonly request: readonly TabChange[];
  readonly response: readonly TabChange[];
  /** The live credential hero: the authorization rule pulled out of Request. */
  readonly token?: TabChange;
  /** This-tab ephemeral overrides, shown dashed and clearly temporary. */
  readonly overrides: readonly TabChange[];
  readonly needsAccess: number;
  readonly refused: number;
  readonly managed: number;
  readonly overridden: number;
  /** Lines only Chrome can settle, counted so the head can own the doubt. */
  readonly unconfirmed: number;
  /** Lines Chrome has not taken yet; nonzero means nothing on screen is live. */
  readonly outOfSync: number;
}

export interface ReadoutInput {
  readonly doc: StateDoc;
  readonly host: string | undefined;
  readonly grants: GrantSnapshot;
  readonly overrides: readonly TabOverride[];
  readonly isRegexSupported: (regex: string) => boolean;
  /** The one system-status ladder, so no line disagrees with the badge. */
  readonly status: SystemStatus;
}

export function computeReadout({
  doc,
  host,
  grants,
  overrides,
  isRegexSupported,
  status,
}: ReadoutInput): TabReadout {
  const paused = status === "paused";
  const outOfSync = status === "out-of-sync";
  const overrideLines = overrides.map((override) =>
    overrideChange(override, grants, paused, outOfSync),
  );
  const profile = activeProfile(doc);

  if (host === undefined) {
    return {
      host,
      request: [],
      response: [],
      overrides: overrideLines,
      ...summarize(overrideLines),
    };
  }

  // Every rule that could reach this host, with its grant gap computed once for
  // the line's needs-access state. A rule Chrome settles per request is carried
  // with its doubt, never dropped from the list and never counted as a match.
  const applying: {
    profile: Profile;
    rule: Rule;
    reach: Reach;
    missing: readonly string[];
  }[] = [];
  for (const rule of profile.rules) {
    const reach = ruleReach(rule, host);
    if (reach === "no") {
      continue;
    }
    applying.push({
      profile,
      rule,
      reach,
      missing: rule.enabled ? missingGrants(rule, grants) : [],
    });
  }

  const overriddenBy = overriddenLabels(doc, grants, isRegexSupported);

  const changes = applying.map(({ profile, rule, reach, missing }) =>
    ruleChange(profile, rule, {
      paused,
      outOfSync,
      reach,
      missing,
      overriddenBy: overriddenBy.get(rule.id),
      isRegexSupported,
    }),
  );

  // The credential hero is a saved-rule surface. This-tab rows retain their
  // lifetime controls in the temporary strip in every state.
  const heroable = (change: TabChange) =>
    isAuthorizationToken(change) && HERO_STATUS.includes(change.status);
  const ruleTokenIndex = changes.findIndex(heroable);
  const token = ruleTokenIndex === -1 ? undefined : changes[ruleTokenIndex];
  const listed = changes.filter((_, index) => index !== ruleTokenIndex);
  return {
    host,
    request: listed.filter((change) => change.direction === "request"),
    response: listed.filter((change) => change.direction === "response"),
    ...(token === undefined ? {} : { token }),
    overrides: overrideLines,
    ...summarize([...changes, ...overrideLines]),
  };
}

type ReadoutSummary = Pick<
  TabReadout,
  | "total"
  | "held"
  | "needsAccess"
  | "refused"
  | "managed"
  | "overridden"
  | "unconfirmed"
  | "outOfSync"
>;

function summarize(changes: readonly TabChange[]): ReadoutSummary {
  return {
    total: changes.filter(
      (change) => change.status === "live" || change.status === "unconfirmed",
    ).length,
    held: changes.filter((change) => change.status === "paused").length,
    needsAccess: changes.filter((change) => change.status === "needs-access")
      .length,
    refused: changes.filter((change) => change.status === "refused").length,
    managed: changes.filter((change) => change.status === "managed").length,
    overridden: changes.filter((change) => change.status === "overridden")
      .length,
    unconfirmed: changes.filter((change) => change.status === "unconfirmed")
      .length,
    outOfSync: changes.filter((change) => change.status === "out-of-sync")
      .length,
  };
}

/**
 * Where the credential card can state its own line's state and stay honest: it
 * reads live plainly, marks a needs-access line, and draws a paused one at rest.
 * Only saved rules enter this policy; temporary overrides stay in their strip
 * at every status so their lifetime controls remain reachable. Being the hero
 * is a placement, not a claim to be running, so pausing moves the card to its
 * resting reading rather than restructuring the popup around the same rules.
 * The states it has no reading for stay in the list, where the line carries the
 * full reason; and a line that lost its header to another rule is never the
 * hero, because the winner is what the tab sends.
 */
const HERO_STATUS: readonly LineStatus[] = ["live", "needs-access", "paused"];

function isAuthorizationToken(change: TabChange): boolean {
  return (
    change.direction === "request" &&
    change.operation !== "remove" &&
    change.value !== undefined &&
    normalizeHeaderName(change.header) === "authorization"
  );
}

/** The redacted reading a rule shows on a line; a remove withholds none. */
export function ruleDisplay(
  rule: Pick<Rule, "operation" | "generated" | "header" | "value">,
): string | undefined {
  return rule.operation === "remove" ? undefined : ruleValueSummary(rule);
}

/**
 * The fields the popup line and the fleet row describe a change with, assembled
 * once so neither surface can add a state the other forgets. Each caller resolves
 * `status` from its own flags and hands the line its display and exceptions; the
 * conditional shape (which exception a status is allowed to name) lives here.
 */
export function lineCore(input: {
  direction: Direction;
  operation: HeaderOp;
  header: string;
  display: string | undefined;
  enabled: boolean;
  status: LineStatus;
  overriddenBy: string | undefined;
  refused: RefusedReason | undefined;
  missing: readonly string[];
}): LineCore {
  return {
    direction: input.direction,
    operation: input.operation,
    header: input.header,
    ...(input.display === undefined ? {} : { display: input.display }),
    secret: isSecretHeader(input.header),
    enabled: input.enabled,
    status: input.status,
    ...(input.status === "overridden" && input.overriddenBy !== undefined
      ? { overriddenBy: input.overriddenBy }
      : {}),
    ...(input.status === "refused" && input.refused !== undefined
      ? { refused: input.refused }
      : {}),
    ...(input.status === "needs-access" ? { missing: input.missing } : {}),
  };
}

function ruleChange(
  profile: Profile,
  rule: Rule,
  context: {
    paused: boolean;
    outOfSync: boolean;
    reach: Reach;
    missing: readonly string[];
    overriddenBy: string | undefined;
    isRegexSupported: (regex: string) => boolean;
  },
): TabChange {
  const refused = refusedReason(rule, context.isRegexSupported);
  const status = lineStatus({
    running: rule.enabled,
    paused: context.paused,
    promoteNeedsAccessWhilePaused: false,
    outOfSync: context.outOfSync,
    overridden: context.overriddenBy !== undefined,
    refused: refused !== undefined,
    managed: isNetworkManagedHeader(rule.header),
    needsAccess: context.missing.length > 0,
    perRequest: context.reach === "unknown",
  });
  const wider = widerReach(rule);
  return {
    key: `${profile.id}:${rule.id}`,
    source: "rule",
    profileId: profile.id,
    ruleId: rule.id,
    ...lineCore({
      direction: rule.direction,
      operation: rule.operation,
      header: rule.header,
      display: ruleDisplay(rule),
      enabled: rule.enabled,
      status,
      overriddenBy: context.overriddenBy,
      refused,
      missing: context.missing,
    }),
    ...(rule.value === undefined ? {} : { value: rule.value }),
    ...(wider === undefined ? {} : { widerReach: wider }),
  };
}

function overrideChange(
  override: TabOverride,
  grants: GrantSnapshot,
  paused: boolean,
  outOfSync: boolean,
): TabChange {
  // A this-tab override compiles to a tabIds + requestDomains condition on the
  // tab it was made from. Its one host is the compiler's grant test, so the
  // popup derives the same needs-access state from the same snapshot.
  const missing = originGranted(override.originHost, grants)
    ? []
    : [originPatternForDomain(override.originHost)];
  const status = lineStatus({
    running: override.enabled,
    paused,
    // A This-tab row keeps its Remove control beside Grant, so access remains
    // actionable even while the global pause is holding everything else.
    promoteNeedsAccessWhilePaused: true,
    outOfSync,
    overridden: false,
    refused: false,
    managed: isNetworkManagedHeader(override.header),
    needsAccess: missing.length > 0,
    perRequest: false,
  });
  return {
    key: `override:${override.num}`,
    source: "override",
    overrideNum: override.num,
    ...lineCore({
      direction: override.direction,
      operation: override.operation,
      header: override.header,
      display:
        override.operation === "remove"
          ? undefined
          : headerValueSummary(override.header, override.value),
      enabled: override.enabled,
      status,
      overriddenBy: undefined,
      refused: undefined,
      missing,
    }),
    ...(override.value === undefined ? {} : { value: override.value }),
  };
}

/**
 * The one severity ladder every projected line reads, popup and Workbench
 * alike, so the same rule can never carry two different states on two surfaces.
 */
export function lineStatus(flags: {
  /** The rule is switched on and its profile is the active one. */
  running: boolean;
  paused: boolean;
  /** Whether a temporary row can expose its grant action while paused. */
  promoteNeedsAccessWhilePaused: boolean;
  outOfSync: boolean;
  overridden: boolean;
  refused: boolean;
  managed: boolean;
  needsAccess: boolean;
  perRequest: boolean;
}): LineStatus {
  // A rule that is switched off, or sits in an inactive profile, is off
  // regardless of pause; only a rule that would otherwise run reads as paused.
  if (!flags.running) return "off";
  // Stored rules stay held while paused: Grant cannot make one run, and pause
  // owns their verb, count, hero reading, and Workbench status. A temporary
  // This-tab row is the exception because its lifetime control remains on the
  // same line beside Grant.
  if (
    flags.paused &&
    !(flags.promoteNeedsAccessWhilePaused && flags.needsAccess)
  ) {
    return "paused";
  }
  // Chrome has not taken the current ruleset, so what is applied is unknown —
  // the same precedence core/status gives it, one line at a time.
  if (flags.outOfSync) return "out-of-sync";
  if (flags.overridden) return "overridden";
  if (flags.refused) return "refused";
  if (flags.managed) return "managed";
  if (flags.needsAccess) return "needs-access";
  if (flags.perRequest) return "unconfirmed";
  return "live";
}

export function isNetworkManagedHeader(header: string): boolean {
  return classifyHeaderName(header).advisories.some(
    (advisory) => advisory.kind === "network-managed",
  );
}

/**
 * Why Chrome refuses this rule, or undefined when it accepts it. The Host
 * header is the classifier's case: extensions cannot change the authority on the
 * HTTP/2 connections most sites use, so the rule is enabled yet refused. Every
 * other reason is the compiler's own, read from the gate that actually drops
 * the rule, so a line can never claim to run something Chrome never received.
 */
export function refusedReason(
  rule: Rule,
  isRegexSupported: (regex: string) => boolean,
): RefusedReason | undefined {
  if (
    classifyHeaderName(rule.header).advisories.some(
      (advisory) => advisory.kind === "host-http2",
    )
  ) {
    return "host";
  }
  return uncompilableReason(rule, isRegexSupported);
}

export interface SwitchPreview {
  /** Header names live now that the target profile does not carry. */
  readonly drops: readonly string[];
  /** Headers the target profile adds, with a redacted value where it has one. */
  readonly adds: readonly {
    readonly header: string;
    readonly display?: string;
  }[];
}

/**
 * What switching profiles would change on this tab, computed before the commit:
 * the biggest silent surprise in any profile tool, turned into a legible local
 * diff. The diff is against the one profile active now.
 */
export function previewSwitch(
  from: Profile,
  to: Profile,
  host: string | undefined,
): SwitchPreview {
  if (host === undefined) {
    return { drops: [], adds: [] };
  }
  // A rule Chrome settles per request is kept in the diff: the preview owes you
  // every header the switch could move, and only Chrome can rule one out.
  const mayReach = (rule: Rule) => ruleReach(rule, host) !== "no";
  const current = new Set<string>();
  for (const rule of from.rules) {
    if (rule.enabled && mayReach(rule)) {
      current.add(normalizeHeaderName(rule.header));
    }
  }
  const targetKeys = new Set<string>();
  const adds: { header: string; display?: string }[] = [];
  for (const rule of to.rules) {
    if (!rule.enabled || !mayReach(rule)) continue;
    const key = normalizeHeaderName(rule.header);
    targetKeys.add(key);
    if (!current.has(key) && !adds.some((add) => add.header === rule.header)) {
      const display = ruleDisplay(rule);
      adds.push({
        header: rule.header,
        ...(display === undefined ? {} : { display }),
      });
    }
  }
  const drops: string[] = [];
  for (const rule of from.rules) {
    const key = normalizeHeaderName(rule.header);
    if (
      rule.enabled &&
      mayReach(rule) &&
      !targetKeys.has(key) &&
      !drops.includes(rule.header)
    ) {
      drops.push(rule.header);
    }
  }
  return { drops, adds };
}

/** What this rule reaches beyond the one host the popup is open on. */
function widerReach(rule: Rule): number | "broad" | undefined {
  const { requestDomains } = scopeCondition(rule.scope);
  if (requestDomains === undefined) return "broad";
  const others = requestDomains.length - 1;
  return others > 0 ? others : undefined;
}

function ruleReach(rule: Rule, host: string): Reach {
  if (!conditionReaches(scopeCondition(rule.scope), host)) {
    return rule.initiators.some((initiator) => hostUnder(host, initiator))
      ? "unknown"
      : "no";
  }
  return settlesPerRequest(rule) ? "unknown" : "yes";
}
