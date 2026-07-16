/**
 * The Workbench's fleet: every rule across every profile, projected once into
 * the same severity ladder the popup readout uses, then grouped two ways. "By
 * site" answers "what does HeaderShim do to this domain"; "by header" answers
 * "where does this one header reach" and is the home for cross-site rules. The
 * traffic receipt is the same projection flattened to the stamps actually live,
 * skipped, or refused right now. Nothing here recomputes match behavior: it
 * reads the model, the grant snapshot, and the refused classifier the engine
 * already owns, and never claims a state the model does not hold.
 */

import { findOverriddenRules } from "../../core/conflicts";
import { type GrantSnapshot, missingGrants } from "../../core/grants";
import { normalizeHeaderName } from "../../core/headers";
import type {
  BadgeColor,
  Direction,
  HeaderOp,
  Profile,
  Rule,
} from "../../core/model";
import { headerValueSummary, isSecretHeader } from "../secret";
import { refusedReason } from "./readout";

/** Per-rule health, in the order the severity spine reads it. */
type FleetStatus =
  | "live"
  | "needs-access"
  | "refused"
  | "overridden"
  | "off"
  | "paused";

interface FleetProvenance {
  readonly profileId: string;
  readonly name: string;
  readonly badgeText: string;
  readonly color: BadgeColor;
}

/** The winner of a same-header collision, and whether it is the rule's own profile. */
interface Overrider {
  readonly name: string;
  readonly sameProfile: boolean;
}

type FleetScope =
  | { readonly kind: "domains"; readonly domains: readonly string[] }
  | { readonly kind: "all" }
  | { readonly kind: "pattern"; readonly hosts: readonly string[] }
  | { readonly kind: "regex"; readonly hosts: readonly string[] };

export interface FleetRule {
  /** Stable key for rendering, focus, and tests. */
  readonly key: string;
  readonly profileId: string;
  readonly ruleId: string;
  readonly provenance: FleetProvenance;
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  /** Normalized header, the grouping key for the by-header lens. */
  readonly headerKey: string;
  readonly value?: string;
  /** The redacted reading shown on the line; undefined for a remove. */
  readonly display?: string;
  readonly secret: boolean;
  readonly enabled: boolean;
  readonly profileEnabled: boolean;
  readonly status: FleetStatus;
  readonly overriddenBy?: Overrider;
  readonly refused?: "host";
  readonly missing?: readonly string[];
  readonly scope: FleetScope;
  /** How many distinct sites this rule names; 0 when its reach is broad. */
  readonly siteCount: number;
  /** True when the scope is not a concrete domain list (all / pattern / regex). */
  readonly crossSite: boolean;
}

export interface FleetInput {
  readonly profiles: readonly Profile[];
  readonly grants: GrantSnapshot;
  readonly paused: boolean;
}

/** Every rule in every profile, in profile then rule order, projected once. */
export function projectFleet({
  profiles,
  grants,
  paused,
}: FleetInput): FleetRule[] {
  // Collisions are resolved across the live set exactly as the compiled ruleset
  // does: enabled rules of enabled profiles, in order, so an earlier one shadows
  // a later one. The Workbench surfaces same-profile shadows too, because that
  // is an authoring choice the author is here to see.
  const live: { profile: Profile; rule: Rule }[] = [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    for (const rule of profile.rules) {
      if (rule.enabled) live.push({ profile, rule });
    }
  }
  const owner = new Map<string, Profile>();
  for (const { profile, rule } of live) owner.set(rule.id, profile);

  const overriddenBy = new Map<string, Overrider>();
  for (const { ruleId, shadowedByRuleId } of findOverriddenRules(
    live.map(({ rule }) => rule),
  )) {
    const winner = owner.get(shadowedByRuleId);
    if (winner !== undefined) {
      overriddenBy.set(ruleId, {
        name: winner.name,
        sameProfile: winner.id === owner.get(ruleId)?.id,
      });
    }
  }

  return profiles.flatMap((profile) =>
    profile.rules.map((rule) =>
      fleetRule(profile, rule, {
        grants,
        paused,
        overriddenBy: overriddenBy.get(rule.id),
      }),
    ),
  );
}

function fleetRule(
  profile: Profile,
  rule: Rule,
  context: {
    grants: GrantSnapshot;
    paused: boolean;
    overriddenBy: Overrider | undefined;
  },
): FleetRule {
  const refused = refusedReason(rule);
  const running = profile.enabled && rule.enabled;
  const missing = running ? missingGrants(rule, context.grants) : [];
  const status = fleetStatus({
    running,
    paused: context.paused,
    overridden: context.overriddenBy !== undefined,
    refused: refused !== undefined,
    needsAccess: missing.length > 0,
  });
  const display =
    rule.operation === "remove"
      ? undefined
      : headerValueSummary(rule.header, rule.value);
  return {
    key: `${profile.id}:${rule.id}`,
    profileId: profile.id,
    ruleId: rule.id,
    provenance: {
      profileId: profile.id,
      name: profile.name,
      badgeText: profile.badgeText,
      color: profile.color,
    },
    direction: rule.direction,
    operation: rule.operation,
    header: rule.header,
    headerKey: normalizeHeaderName(rule.header),
    ...(rule.value === undefined ? {} : { value: rule.value }),
    ...(display === undefined ? {} : { display }),
    secret: isSecretHeader(rule.header),
    enabled: rule.enabled,
    profileEnabled: profile.enabled,
    status,
    // The collision winner is named only where the loser is actually running;
    // an off rule is off, not overridden.
    ...(status === "overridden" && context.overriddenBy !== undefined
      ? { overriddenBy: context.overriddenBy }
      : {}),
    ...(status === "refused" && refused !== undefined ? { refused } : {}),
    ...(status === "needs-access" ? { missing } : {}),
    scope: fleetScope(rule),
    siteCount: siteCount(rule),
    crossSite: rule.scope.type !== "domains",
  };
}

function fleetStatus(flags: {
  running: boolean;
  paused: boolean;
  overridden: boolean;
  refused: boolean;
  needsAccess: boolean;
}): FleetStatus {
  // A disabled rule (or one in an off profile) is off regardless of pause; only
  // a rule that would otherwise run reads as paused.
  if (!flags.running) return "off";
  if (flags.paused) return "paused";
  if (flags.overridden) return "overridden";
  if (flags.refused) return "refused";
  if (flags.needsAccess) return "needs-access";
  return "live";
}

function fleetScope(rule: Rule): FleetScope {
  switch (rule.scope.type) {
    case "domains":
      return { kind: "domains", domains: [...rule.scope.domains] };
    case "all":
      return { kind: "all" };
    case "pattern":
      return { kind: "pattern", hosts: [...rule.scope.hosts] };
    case "regex":
      return { kind: "regex", hosts: [...rule.scope.hosts] };
  }
}

function siteCount(rule: Rule): number {
  switch (rule.scope.type) {
    case "domains":
      return rule.scope.domains.length;
    case "pattern":
    case "regex":
      return rule.scope.hosts.length;
    case "all":
      return 0;
  }
}

export interface SiteGroup {
  readonly kind: "domain" | "cross-site";
  /** The domain, or a stable sentinel ("*") for the cross-site bucket. */
  readonly host: string;
  readonly rules: readonly FleetRule[];
}

/**
 * By site: a rule that names domains appears under each; every broad rule (all
 * sites, pattern, regex) collects into one trailing cross-site group, since its
 * true home is the by-header lens where its reach is legible.
 */
export function groupBySite(fleet: readonly FleetRule[]): SiteGroup[] {
  const domains = new Map<string, FleetRule[]>();
  const crossSite: FleetRule[] = [];
  for (const rule of fleet) {
    if (rule.scope.kind === "domains") {
      for (const domain of rule.scope.domains) {
        push(domains, domain, rule);
      }
    } else {
      crossSite.push(rule);
    }
  }
  const groups: SiteGroup[] = [...domains.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, rules]) => ({ kind: "domain" as const, host, rules }));
  if (crossSite.length > 0) {
    groups.push({ kind: "cross-site", host: "*", rules: crossSite });
  }
  return groups;
}

export interface HeaderGroup {
  readonly headerKey: string;
  /** The header as first authored, for display. */
  readonly header: string;
  readonly rules: readonly FleetRule[];
  /** Distinct named sites this header reaches; the blast radius. */
  readonly siteCount: number;
  /** True when any rule for this header reaches beyond named sites. */
  readonly broad: boolean;
}

/**
 * By header: every rule touching one header name, across sites and profiles, in
 * one place. The blast radius (distinct sites, plus whether any rule is broad)
 * makes a one-edit change legible before it is made.
 */
export function groupByHeader(fleet: readonly FleetRule[]): HeaderGroup[] {
  const groups = new Map<string, FleetRule[]>();
  for (const rule of fleet) push(groups, rule.headerKey, rule);
  return [...groups.entries()]
    .map(([headerKey, rules]) => {
      const sites = new Set<string>();
      let broad = false;
      for (const rule of rules) {
        if (rule.scope.kind === "domains") {
          for (const domain of rule.scope.domains) sites.add(domain);
        } else {
          broad = true;
          for (const host of hostsOf(rule)) sites.add(host);
        }
      }
      return {
        headerKey,
        header: rules[0]?.header ?? headerKey,
        rules,
        siteCount: sites.size,
        broad,
      };
    })
    .sort((a, b) => a.header.localeCompare(b.header));
}

export interface TapeRow {
  readonly key: string;
  readonly host: string;
  readonly kind: "domain" | "cross-site";
  readonly direction: Direction;
  readonly operation: HeaderOp;
  readonly header: string;
  readonly secret: boolean;
  readonly provenance: FleetProvenance;
  /** Only the states that describe live traffic reach the tape. */
  readonly status: "live" | "needs-access" | "refused" | "paused";
}

const TAPE_ORDER: Record<TapeRow["status"], number> = {
  refused: 0,
  "needs-access": 1,
  live: 2,
  paused: 3,
};

/**
 * The receipt: every stamp HeaderShim is set to apply right now, grouped by the
 * site it lands on, plus the ones it is skipping (ungranted) or Chrome refuses.
 * Off rules are not traffic and never appear; values are never carried, so a
 * secret is categorically absent from the record.
 */
export function tapeRows(groups: readonly SiteGroup[]): TapeRow[] {
  const rows: TapeRow[] = [];
  for (const group of groups) {
    for (const rule of group.rules) {
      if (rule.status === "off" || rule.status === "overridden") {
        continue;
      }
      rows.push({
        key: `${group.host}:${rule.key}`,
        host: group.host,
        kind: group.kind,
        direction: rule.direction,
        operation: rule.operation,
        header: rule.header,
        secret: rule.secret,
        provenance: rule.provenance,
        status: rule.status,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      TAPE_ORDER[a.status] - TAPE_ORDER[b.status] || a.key.localeCompare(b.key),
  );
}

function hostsOf(rule: FleetRule): readonly string[] {
  return rule.scope.kind === "pattern" || rule.scope.kind === "regex"
    ? rule.scope.hosts
    : [];
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
}
