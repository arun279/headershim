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
  dropUncompilable,
  settlesPerRequest,
  type UncompilableReason,
  uncompilableReason,
} from "../../core/compile";
import { findOverriddenRules } from "../../core/conflicts";
import type { GrantSnapshot } from "../../core/grants";
import { missingGrants } from "../../core/grants";
import { classifyHeaderName, normalizeHeaderName } from "../../core/headers";
import {
  activeProfile,
  type Direction,
  type HeaderOp,
  type Profile,
  type Rule,
  type Scope,
  type StateDoc,
  type TabOverride,
} from "../../core/model";
import type { SystemStatus } from "../../core/status";
import {
  headerValueSummary,
  isSecretHeader,
  ruleValueSummary,
} from "../secret";

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

export interface TabChange {
  /** Stable key for rendering, focus, and tests. */
  readonly key: string;
  readonly source: "rule" | "override";
  readonly profileId?: string;
  readonly ruleId?: string;
  readonly overrideNum?: number;
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  readonly value?: string;
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
  const paused = status.kind === "paused";
  const outOfSync = status.kind === "out-of-sync";
  const overrideLines = overrides.map((override) =>
    overrideChange(override, paused, outOfSync),
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

  // Every rule in the active profile that could reach this host, in precedence
  // order, so an earlier rule shadows a later one exactly as compilation does.
  // A rule Chrome settles per request is carried with its doubt, never dropped
  // from the list and never counted as a match.
  const applying: { profile: Profile; rule: Rule; reach: Reach }[] = [];
  if (profile !== undefined) {
    for (const rule of profile.rules) {
      const reach = ruleReach(rule, host);
      if (reach !== "no") {
        applying.push({ profile, rule, reach });
      }
    }
  }

  const compilableProfile = activeProfile(
    dropUncompilable(doc, isRegexSupported),
  );
  const compilableRules = compilableProfile?.rules ?? [];
  const overriddenBy = new Map<string, string>();
  const rulesById = new Map<string, Rule>();
  for (const rule of compilableRules) rulesById.set(rule.id, rule);
  for (const { ruleId, shadowedByRuleId } of findOverriddenRules(
    compilableRules,
  )) {
    const winner = rulesById.get(shadowedByRuleId);
    if (winner !== undefined) {
      overriddenBy.set(ruleId, ruleLabel(winner));
    }
  }

  const changes = applying.map(({ profile, rule, reach }) =>
    ruleChange(profile, rule, {
      grants,
      paused,
      outOfSync,
      reach,
      overriddenBy: overriddenBy.get(rule.id),
      isRegexSupported,
    }),
  );

  // The credential hero prefers a live this-tab swap over the stored rule, so a
  // Swap reads back as the value it just set; otherwise it is the rule itself.
  const heroable = (change: TabChange) =>
    isAuthorizationToken(change) && HERO_STATUS.includes(change.status);
  const overrideToken = overrideLines.find(heroable);
  const ruleTokenIndex = changes.findIndex(heroable);
  const token =
    overrideToken ??
    (ruleTokenIndex === -1 ? undefined : changes[ruleTokenIndex]);

  const listedOverrides =
    overrideToken === undefined
      ? overrideLines
      : overrideLines.filter((line) => line !== overrideToken);
  const listed = changes.filter(
    (_, index) => overrideToken !== undefined || index !== ruleTokenIndex,
  );
  return {
    host,
    request: listed.filter((change) => change.direction === "request"),
    response: listed.filter((change) => change.direction === "response"),
    ...(token === undefined ? {} : { token }),
    overrides: listedOverrides,
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
 * reads live plainly, marks a needs-access line, and draws a paused one
 * at rest. Being the hero is a placement, not a claim to be running, so pausing
 * moves the card to its resting reading rather than restructuring the popup
 * around the same rules. The states it has no reading for stay in the list,
 * where the line carries the full reason; and a line that lost its header to
 * another rule is never the hero, because the winner is what the tab sends.
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

function ruleChange(
  profile: Profile,
  rule: Rule,
  context: {
    grants: GrantSnapshot;
    paused: boolean;
    outOfSync: boolean;
    reach: Reach;
    overriddenBy: string | undefined;
    isRegexSupported: (regex: string) => boolean;
  },
): TabChange {
  const refused = refusedReason(rule, context.isRegexSupported);
  const missing = rule.enabled ? missingGrants(rule, context.grants) : [];
  const status = lineStatus({
    running: rule.enabled,
    paused: context.paused,
    outOfSync: context.outOfSync,
    overridden: context.overriddenBy !== undefined,
    refused: refused !== undefined,
    managed: isNetworkManagedHeader(rule.header),
    needsAccess: missing.length > 0,
    perRequest: context.reach === "unknown",
  });
  const secret = isSecretHeader(rule.header);
  const display =
    rule.operation === "remove" ? undefined : ruleValueSummary(rule);
  const wider = widerReach(rule);
  return {
    key: `${profile.id}:${rule.id}`,
    source: "rule",
    profileId: profile.id,
    ruleId: rule.id,
    direction: rule.direction,
    operation: rule.operation,
    header: rule.header,
    ...(rule.value === undefined ? {} : { value: rule.value }),
    ...(display === undefined ? {} : { display }),
    secret,
    enabled: rule.enabled,
    status,
    ...(context.overriddenBy === undefined
      ? {}
      : { overriddenBy: context.overriddenBy }),
    ...(status === "needs-access" ? { missing } : {}),
    ...(status === "refused" && refused !== undefined ? { refused } : {}),
    ...(wider === undefined ? {} : { widerReach: wider }),
  };
}

function overrideChange(
  override: TabOverride,
  paused: boolean,
  outOfSync: boolean,
): TabChange {
  // A this-tab override compiles to a tabIds + requestDomains condition on the
  // tab it was made from: nothing here is granted, refused, or settled per
  // request, so only the ladder's global rungs can move it off live.
  const status = lineStatus({
    running: override.enabled,
    paused,
    outOfSync,
    overridden: false,
    refused: false,
    managed: isNetworkManagedHeader(override.header),
    needsAccess: false,
    perRequest: false,
  });
  const display =
    override.operation === "remove"
      ? undefined
      : headerValueSummary(override.header, override.value);
  return {
    key: `override:${override.num}`,
    source: "override",
    overrideNum: override.num,
    direction: override.direction,
    operation: override.operation,
    header: override.header,
    ...(override.value === undefined ? {} : { value: override.value }),
    ...(display === undefined ? {} : { display }),
    secret: isSecretHeader(override.header),
    enabled: override.enabled,
    status,
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
  if (flags.paused) return "paused";
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
  from: Profile | undefined,
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
  if (from !== undefined) {
    for (const rule of from.rules) {
      if (rule.enabled && mayReach(rule)) {
        current.add(normalizeHeaderName(rule.header));
      }
    }
  }
  const targetKeys = new Set<string>();
  const adds: { header: string; display?: string }[] = [];
  for (const rule of to.rules) {
    if (!rule.enabled || !mayReach(rule)) continue;
    const key = normalizeHeaderName(rule.header);
    targetKeys.add(key);
    if (!current.has(key) && !adds.some((add) => add.header === rule.header)) {
      const display =
        rule.operation === "remove" ? undefined : ruleValueSummary(rule);
      adds.push({
        header: rule.header,
        ...(display === undefined ? {} : { display }),
      });
    }
  }
  const drops: string[] = [];
  if (from !== undefined) {
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
  }
  return { drops, adds };
}

export function ruleLabel(rule: Rule): string {
  const comment = rule.comment?.trim();
  return comment === undefined || comment.length === 0
    ? `${rule.header} rule`
    : comment;
}

/** What this rule reaches beyond the one host the popup is open on. */
function widerReach(rule: Rule): number | "broad" | undefined {
  if (rule.scope.type !== "domains") return "broad";
  const others = rule.scope.domains.length - 1;
  return others > 0 ? others : undefined;
}

function ruleReach(rule: Rule, host: string): Reach {
  const scoped = scopeReach(rule.scope, host);
  if (
    scoped === "no" &&
    rule.initiators.some((initiator) => hostUnder(host, initiator))
  ) {
    return "unknown";
  }
  return scoped === "yes" && settlesPerRequest(rule) ? "unknown" : scoped;
}

/**
 * What the scope alone rules out, before Chrome's matcher gets a say. Only a
 * named-domain list answers "no" from here; every other scope can reach this
 * tab, and settlesPerRequest decides whether that is knowable.
 */
function scopeReach(scope: Scope, host: string): "yes" | "no" {
  if (scope.type !== "domains") {
    return "yes";
  }
  return scope.domains.some((domain) => hostUnder(host, domain)) ? "yes" : "no";
}

function hostUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
