/**
 * The Workbench's fleet: every rule across every profile, projected once into
 * the same severity ladder the popup readout uses, then grouped two ways. "By
 * site" answers "what does HeaderShim do to this domain"; "by header" answers
 * "where does this one header reach" and is the home for cross-site rules. The
 * traffic receipt is the same projection flattened to the stamps live, managed,
 * skipped, or refused right now. Nothing here recomputes match behavior: the
 * severity ladder, the refused classifier and the per-request test are the same
 * ones the popup readout reads, so a rule cannot carry one state here and another
 * there.
 */

import { dropUncompilable, settlesPerRequest } from "../../core/compile";
import { findOverriddenRules } from "../../core/conflicts";
import { type GrantSnapshot, missingGrants } from "../../core/grants";
import { normalizeHeaderName } from "../../core/headers";
import {
  activeProfile,
  type BadgeColor,
  type Direction,
  type HeaderOp,
  type Profile,
  type Rule,
  type StateDoc,
} from "../../core/model";
import type { SystemStatus } from "../../core/status";
import { isSecretHeader, ruleValueSummary } from "../secret";
import {
  isNetworkManagedHeader,
  type LineStatus,
  lineStatus,
  type RefusedReason,
  refusedReason,
  ruleLabel,
} from "./readout";

interface FleetProvenance {
  readonly profileId: string;
  readonly name: string;
  readonly badgeText: string;
  readonly color: BadgeColor;
}

interface Overrider {
  readonly label: string;
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
  /** The redacted reading shown on the line; undefined for a remove. */
  readonly display?: string;
  readonly secret: boolean;
  readonly enabled: boolean;
  readonly profileEnabled: boolean;
  readonly status: LineStatus;
  readonly overriddenBy?: Overrider;
  readonly refused?: RefusedReason;
  readonly missing?: readonly string[];
  readonly scope: FleetScope;
  /** How many distinct sites this rule names; 0 when its reach is broad. */
  readonly siteCount: number;
  /** True when the scope is not a concrete domain list (all / pattern / regex). */
  readonly crossSite: boolean;
  /** The author's own note on the rule, when they left one. */
  readonly comment?: string;
}

export interface FleetInput {
  readonly doc: StateDoc;
  readonly grants: GrantSnapshot;
  readonly isRegexSupported: (regex: string) => boolean;
  /** The one system-status ladder, so no row disagrees with the badge. */
  readonly status: SystemStatus;
}

/** Every rule in every profile, in profile then rule order, projected once. */
export function projectFleet({
  doc,
  grants,
  isRegexSupported,
  status,
}: FleetInput): FleetRule[] {
  // Collisions are resolved across the live set exactly as the compiled ruleset
  // does: enabled rules of the active profile, in order, so an earlier one
  // shadows a later one.
  const compilable = dropUncompilable(doc, isRegexSupported);
  const liveProfile = activeProfile(compilable);
  const live: { profile: Profile; rule: Rule }[] = [];
  if (liveProfile !== undefined) {
    for (const rule of liveProfile.rules) {
      if (rule.enabled) live.push({ profile: liveProfile, rule });
    }
  }
  const activeProfileId = activeProfile(doc)?.id;
  const rulesById = new Map<string, Rule>();
  for (const { rule } of live) rulesById.set(rule.id, rule);

  const overriddenBy = new Map<string, Overrider>();
  for (const { ruleId, shadowedByRuleId } of findOverriddenRules(
    live.map(({ rule }) => rule),
  )) {
    const winner = rulesById.get(shadowedByRuleId);
    if (winner !== undefined) {
      overriddenBy.set(ruleId, {
        label: ruleLabel(winner),
      });
    }
  }

  return doc.profiles.flatMap((profile) =>
    profile.rules.map((rule) =>
      fleetRule(profile, rule, {
        grants,
        paused: status.kind === "paused",
        outOfSync: status.kind === "out-of-sync",
        active: profile.id === activeProfileId,
        overriddenBy: overriddenBy.get(rule.id),
        isRegexSupported,
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
    outOfSync: boolean;
    active: boolean;
    overriddenBy: Overrider | undefined;
    isRegexSupported: (regex: string) => boolean;
  },
): FleetRule {
  const refused = refusedReason(rule, context.isRegexSupported);
  const running = context.active && rule.enabled;
  const missing = running ? missingGrants(rule, context.grants) : [];
  const status = lineStatus({
    running,
    paused: context.paused,
    outOfSync: context.outOfSync,
    overridden: context.overriddenBy !== undefined,
    refused: refused !== undefined,
    managed: isNetworkManagedHeader(rule.header),
    needsAccess: missing.length > 0,
    perRequest: settlesPerRequest(rule),
  });
  const display =
    rule.operation === "remove" ? undefined : ruleValueSummary(rule);
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
    ...(display === undefined ? {} : { display }),
    secret: isSecretHeader(rule.header),
    enabled: rule.enabled,
    profileEnabled: context.active,
    ...(rule.comment === undefined || rule.comment === ""
      ? {}
      : { comment: rule.comment }),
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
  /** True when any rule for this header reaches every site unconditionally. */
  readonly allSites: boolean;
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
      let allSites = false;
      for (const rule of rules) {
        if (rule.scope.kind === "domains") {
          for (const domain of rule.scope.domains) sites.add(domain);
        } else {
          broad = true;
          if (rule.scope.kind === "all") allSites = true;
          for (const host of hostsOf(rule)) sites.add(host);
        }
      }
      return {
        headerKey,
        header: rules[0]?.header ?? headerKey,
        rules,
        siteCount: sites.size,
        broad,
        allSites,
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
  /** Only enabled active-profile states reach the tape. */
  readonly status: Exclude<LineStatus, "off" | "overridden">;
  readonly refused?: RefusedReason;
}

const TAPE_ORDER: Record<TapeRow["status"], number> = {
  refused: 0,
  managed: 1,
  "out-of-sync": 2,
  "needs-access": 3,
  unconfirmed: 4,
  live: 5,
  paused: 6,
};

/**
 * The receipt: every stamp HeaderShim is set to apply right now, grouped by the
 * site it lands on, plus the ones it is skipping, Chrome manages, or Chrome
 * refuses. Off rules are not traffic and never appear; values are never carried,
 * so a secret is categorically absent from the record.
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
        ...(rule.status === "refused" && rule.refused !== undefined
          ? { refused: rule.refused }
          : {}),
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
