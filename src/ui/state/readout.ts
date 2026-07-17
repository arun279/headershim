/**
 * The popup's one question, answered as data: what is HeaderShim doing to the
 * tab in front of you, and how live is each change. A pure projection over the
 * active profile, the active host, the grant snapshot, and this-tab overrides
 * — it renders the same severity ladder core/status already computes, one line
 * at a time, and never invents a state the model does not hold.
 */

import { findOverriddenRules } from "../../core/conflicts";
import type { GrantSnapshot } from "../../core/grants";
import { missingGrants } from "../../core/grants";
import { classifyHeaderName, normalizeHeaderName } from "../../core/headers";
import type {
  Direction,
  HeaderOp,
  Profile,
  Rule,
  TabOverride,
} from "../../core/model";
import { headerValueSummary, isSecretHeader } from "../secret";

/** Per-line health, in the same order the severity spine reads it. */
type LineStatus =
  | "live"
  | "needs-access"
  | "refused"
  | "overridden"
  | "off"
  | "paused";

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
  readonly refused?: "host";
  /** Origins to grant, when this line needs access. */
  readonly missing?: readonly string[];
}

export interface TabReadout {
  readonly host: string | undefined;
  /** Every persistent change that reaches this tab, including the token line. */
  readonly total: number;
  readonly request: readonly TabChange[];
  readonly response: readonly TabChange[];
  /** The live credential hero: the authorization rule pulled out of Request. */
  readonly token?: TabChange;
  /** This-tab ephemeral overrides, shown dashed and clearly temporary. */
  readonly overrides: readonly TabChange[];
  readonly needsAccess: number;
  readonly refused: number;
  readonly overridden: number;
}

export interface ReadoutInput {
  readonly activeProfile: Profile | undefined;
  readonly host: string | undefined;
  readonly grants: GrantSnapshot;
  readonly overrides: readonly TabOverride[];
  readonly paused: boolean;
}

export function computeReadout({
  activeProfile,
  host,
  grants,
  overrides,
  paused,
}: ReadoutInput): TabReadout {
  const overrideLines = overrides.map((override) =>
    overrideChange(override, paused),
  );

  if (host === undefined) {
    return {
      host,
      total: 0,
      request: [],
      response: [],
      overrides: overrideLines,
      needsAccess: 0,
      refused: 0,
      overridden: 0,
    };
  }

  // Every rule in the active profile that reaches this host, in precedence
  // order, so an earlier rule shadows a later one exactly as compilation does.
  const applying: { profile: Profile; rule: Rule }[] = [];
  if (activeProfile !== undefined) {
    const profile = activeProfile;
    for (const rule of profile.rules) {
      if (ruleAppliesToHost(rule, host)) {
        applying.push({ profile, rule });
      }
    }
  }

  const overriddenBy = new Map<string, string>();
  const rulesById = new Map<string, Rule>();
  for (const { rule } of applying) {
    rulesById.set(rule.id, rule);
  }
  for (const { ruleId, shadowedByRuleId } of findOverriddenRules(
    applying.map(({ rule }) => rule),
  )) {
    const winner = rulesById.get(shadowedByRuleId);
    if (winner !== undefined) {
      overriddenBy.set(ruleId, ruleLabel(winner));
    }
  }

  const changes = applying.map(({ profile, rule }) =>
    ruleChange(profile, rule, {
      grants,
      paused,
      overriddenBy: overriddenBy.get(rule.id),
    }),
  );

  // The credential hero prefers a live this-tab swap over the stored rule, so a
  // Swap reads back as the value it just set; otherwise it is the rule itself.
  // Under pause nothing runs and an off token is not live, so neither is a hero.
  const heroable = (change: TabChange) =>
    !paused &&
    isAuthorizationToken(change) &&
    change.status !== "off" &&
    change.status !== "overridden";
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
    // "N changes on this tab" counts what is running or trying to; a turned-off
    // line still renders so it can be turned back on, but it is not a change.
    total: changes.filter(
      (change) => change.status !== "off" && change.status !== "overridden",
    ).length,
    request: listed.filter((change) => change.direction === "request"),
    response: listed.filter((change) => change.direction === "response"),
    ...(token === undefined ? {} : { token }),
    overrides: listedOverrides,
    needsAccess: changes.filter((c) => c.status === "needs-access").length,
    refused: changes.filter((c) => c.status === "refused").length,
    overridden: changes.filter((c) => c.status === "overridden").length,
  };
}

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
    overriddenBy: string | undefined;
  },
): TabChange {
  const refused = refusedReason(rule);
  const missing = rule.enabled ? missingGrants(rule, context.grants) : [];
  const status = lineStatus({
    paused: context.paused,
    enabled: rule.enabled,
    overridden: context.overriddenBy !== undefined,
    refused: refused !== undefined,
    needsAccess: missing.length > 0,
  });
  const secret = isSecretHeader(rule.header);
  const display =
    rule.operation === "remove"
      ? undefined
      : headerValueSummary(rule.header, rule.value);
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
  };
}

function overrideChange(override: TabOverride, paused: boolean): TabChange {
  const status: LineStatus = paused
    ? "paused"
    : override.enabled
      ? "live"
      : "off";
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

function lineStatus(flags: {
  paused: boolean;
  enabled: boolean;
  overridden: boolean;
  refused: boolean;
  needsAccess: boolean;
}): LineStatus {
  if (flags.paused) return "paused";
  if (!flags.enabled) return "off";
  if (flags.overridden) return "overridden";
  if (flags.refused) return "refused";
  if (flags.needsAccess) return "needs-access";
  return "live";
}

/**
 * A rule Chrome will not apply, known from the header alone. The Host header is
 * the honest case: extensions cannot change the authority on the HTTP/2
 * connections most sites use, so the rule is enabled yet refused.
 */
export function refusedReason(rule: Rule): "host" | undefined {
  return classifyHeaderName(rule.header).advisories.some(
    (advisory) => advisory.kind === "host-http2",
  )
    ? "host"
    : undefined;
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
  const current = new Set<string>();
  if (from !== undefined) {
    for (const rule of from.rules) {
      if (rule.enabled && ruleAppliesToHost(rule, host)) {
        current.add(normalizeHeaderName(rule.header));
      }
    }
  }
  const targetKeys = new Set<string>();
  const adds: { header: string; display?: string }[] = [];
  for (const rule of to.rules) {
    if (!rule.enabled || !ruleAppliesToHost(rule, host)) continue;
    const key = normalizeHeaderName(rule.header);
    targetKeys.add(key);
    if (!current.has(key) && !adds.some((add) => add.header === rule.header)) {
      const display =
        rule.operation === "remove"
          ? undefined
          : headerValueSummary(rule.header, rule.value);
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
        ruleAppliesToHost(rule, host) &&
        !targetKeys.has(key) &&
        !drops.includes(rule.header)
      ) {
        drops.push(rule.header);
      }
    }
  }
  return { drops, adds };
}

function ruleLabel(rule: Rule): string {
  const comment = rule.comment?.trim();
  return comment === undefined || comment.length === 0
    ? `${rule.header} rule`
    : comment;
}

function ruleAppliesToHost(rule: Rule, host: string): boolean {
  switch (rule.scope.type) {
    case "all":
      return true;
    case "domains":
      return rule.scope.domains.some((domain) => hostUnder(host, domain));
    case "pattern":
    case "regex":
      // A pattern/regex with no persisted hosts is broad (all sites); one that
      // recorded hosts applies where it was granted.
      return (
        rule.scope.hosts.length === 0 ||
        rule.scope.hosts.some((named) => hostUnder(host, named))
      );
  }
}

function hostUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
